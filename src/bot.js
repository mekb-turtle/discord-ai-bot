import { Client, Events, GatewayIntentBits, MessageType, PermissionsBitField, Partials } from "discord.js";
import { Logger, LogLevel } from "meklog";
import fs from "node:fs";
import dotenv from "dotenv";
import axios from "axios";
import tmp from "tmp-promise";

dotenv.config();

const originalModel = process.env.MODEL;
const ollamaURL = new URL(process.env.OLLAMA);
const channels = process.env.CHANNELS.split(",");

const emojis = {
	// Replace with your own emojis, remove if you don't want to use emojis
	no: "<:no:1117767793157345301>",
	yes: "<:yes:1117767791089561691>"
};

function emoji(e, message) {
	if (typeof e == "string" && e.length > 0) {
		let guild = message;
		if (message.member?.guild) guild = guild.member?.guild;
		else if (guild.guild) guild = guild.guild;
		if (!guild.members) return e;
		if (!guild.members.me) return e;
		if (guild.members.me.permissionsIn(message.channel).has(PermissionsBitField.Flags.UseExternalEmojis)) return e;
	}
	return "";
}

async function makeRequest(path, method, data) {
	const url = new URL(ollamaURL);
	if (path.startsWith("/")) path = path.substring(1);
	if (!url.pathname.endsWith("/")) url.pathname += "/";
	url.pathname += path;
	const result = await axios({
		method, url, data
	});
	return result.data;
}

let log;
process.on("message", data => {
	if (data.shardID) client.shardID = data.shardID;
	if (data.logger) log = new Logger(data.logger);
});

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.DirectMessages,
		GatewayIntentBits.MessageContent
	],
	allowedMentions: { users: [], roles: [], repliedUser: false },
	partials: [
		Partials.Channel
	]
});

client.once(Events.ClientReady, async () => {
	await client.guilds.fetch();
	client.user.setPresence({ activities: [], status: "online" });
});

const messages = {};

// split text
function splitText(str, length) {
	// trim matches different characters to \s
	str = str
		.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
		.replace(/^\s+|\s+$/g, "");
	const segments = [];
	let segment = "";
	let word, suffix;
	function appendSegment() {
		segment = segment.replace(/^\s+|\s+$/g, "");
		if (segment.length > 0) {
			segments.push(segment);
			segment = "";
		}
	}
	// match a word
	while ((word = str.match(/^[^\s]*(?:\s+|$)/)) != null) {
		suffix = "";
		word = word[0];
		if (word.length == 0) break;
		if (segment.length + word.length > length) {
			// prioritise splitting by newlines over other whitespaces
			if (segment.includes("\n")) {
				// append up all but last paragraph
				const beforeParagraph = segment.match(/^.*\n/s);
				if (beforeParagraph != null) {
					const lastParagraph = segment.substring(beforeParagraph[0].length, segment.length);
					segment = beforeParagraph[0];
					appendSegment();
					segment = lastParagraph;
					continue;
				}
			}
			appendSegment();
			// if word is larger than the split length
			if (word.length > length) {
				word = word.substring(0, length);
				if (length > 1 && word.match(/^[^\s]+$/)) {
					// try to hyphenate word
					word = word.substring(0, word.length - 1);
					suffix = "-";
				}
			}
		}
		str = str.substring(word.length, str.length);
		segment += word + suffix;
	}
	appendSegment();
	return segments;
}

function getSystemMessage() {
	// feel free to change
	return `
The current date and time is ${new Date().toUTCString()}.

Basic markdown is supported.
Bold: **bold text here**
Italics: _italic text here_
Underlined: __underlined text here__
Strikethrough: ~~strikethrough text here~~
Spoiler: ||spoiler text here||
Block quotes: Start the line with a > followed by a space, e.g
> Hello there

Inline code blocks are supported by surrounding text in backticks, e.g ${"`"}print("Hello");${"`"}, block code is supported by surrounding text in three backticks, e.g ${"```"}print("Hello");${"```"}.
Surround code that is produced in code blocks. Use a code block with three backticks if the code has multiple lines, otherwise use an inline code block with one backtick.

Lists are supported by starting the line with a dash followed by a space, e.g - List
Numbered lists are supported by starting the line with a number followed by a dot and a space, e.g 1. List.
Images, links, tables, LaTeX, and anything else is not supported.

If you need to use the symbols >, |, _, *, ~, @, #, :, ${"`"}, put a backslash before them to escape them.
`.trim();
}

let handlingMessage = false;
const messageQueue = [];
client.on(Events.MessageCreate, async message => {
	messageQueue.push(message);
});

setInterval(async () => {
	if (handlingMessage) return;
	handlingMessage = true;
	const message = messageQueue.pop();
	try {
		if (message) await handleMessage(message);
	} catch (error) {
		if (error.response) {
			let str = `Error ${error.response.status} ${error.response.statusText}: ${error.request.method} ${error.request.path}`;
			if (error.response.data?.error) {
				str += ": " + error.response.data.error;
			}
			log(LogLevel.Error, str);
		} else {
			log(LogLevel.Error, error.stack);
		}
	}
	handlingMessage = false;
}, 10);

const model = "discordbot";

async function createModel() {
	try {
		await makeRequest("/api/delete", "delete", {
			name: model
		});
	} catch (error) {}

	const { fd, path, cleanup } = await tmp.file({ prefix: "Modelfile" });
	const writeStream = fs.createWriteStream(null, { fd });

	const finishPromise = new Promise((resolve, reject) => {
		writeStream.once("finish", resolve);
		writeStream.once("error", reject);
	});
	writeStream.write(`
FROM ${originalModel}
SYSTEM """
${getSystemMessage().replace(/"""/g, "\" \" \"")}
"""
		`);
	writeStream.end();
	try {
		await finishPromise;
	} catch (error) {
		writeStream.close();
		await cleanup();
		throw error;
	}
	writeStream.close();

	const response = await makeRequest("/api/create", "post", {
		name: model,
		path
	});
	if (response.status?.startsWith?.("failed to open file")) throw response.status;
	await cleanup();
}

let initModel = false;

async function handleMessage(message) {
	let typing = false;
	try {
		await message.fetch();

		// return if not in the right channel
		const channelID = message.channel.id;
		if (message.guild && !channels.includes(channelID)) return;

		// return if user is a bot, or non-default message
		if (!message.author.id) return;
		if (message.author.bot) return;

		const botRole = message.guild?.members?.me?.roles?.botRole;
		const myMention = new RegExp(`<@((!?${client.user.id}${botRole ? `)|(&${botRole.id}` : ""}))>`, "g");

		if (typeof message.content != "string" || message.content.length == 0) {
			return;
		}

		let context = null;
		if (message.type == MessageType.Reply) {
			const reply = await message.fetchReference();
			if (!reply) return;
			if (reply.author.id != client.user.id) return;
			if (messages[channelID] == null) return;
			if ((context = messages[channelID][reply.id]) == null) return;
		} else if (message.type != MessageType.Default || (message.guild && !message.content.match(myMention))) {
			return;
		}

		if (message.guild) {
			await message.guild.channels.fetch();
			await message.guild.members.fetch();
		}
		const userInput = `${message.content
			.replace(myMention, "")
			.replace(/<#([0-9]+)>/g, (_, id) => {
				if (message.guild) {
					const chn = message.guild.channels.cache.get(id);
					if (chn) return `#${chn.name}`;
				}
				return "#unknown-channel";
			})
			.replace(/<@!?([0-9]+)>/g, (_, id) => {
				if (id == message.author.id) return message.author.username;
				if (message.guild) {
					const mem = message.guild.members.cache.get(id);
					if (mem) return `@${mem.user.username}`;
				}
				return "@unknown-user";
			})
			.replace(/<:([a-zA-Z0-9_]+):([0-9]+)>/g, (_, name) => {
				return `emoji:${name}:`;
			})
			.trim()}`;

		if (userInput == ".reset" || userInput == ".clear") {
			if (messages[channelID] == null) return;

			// reset conversation
			const cleared = messages[channelID].amount;

			// clear
			delete messages[channelID];

			await message.reply({ content: `${emoji(emojis?.yes, message)} Cleared conversation of ${cleared} messages` });
			return;
		}

		// create conversation
		if (messages[channelID] == null) {
			messages[channelID] = { amount: 0, last: null };
		}

		// log user's message
		log(LogLevel.Debug, `${message.guild ? `#${message.channel.name}` : "DMs"} - ${message.author.username}: ${userInput}`);

		// start typing
		typing = true;
		await message.channel.sendTyping();
		let typingInterval = setInterval(async () => {
			try {
				await message.channel.sendTyping();
			} catch (error) {
				if (typingInterval != null) {
					clearInterval(typingInterval);
				}
				typingInterval = null;
			}
		}, 7000);

		let response;
		try {
			if (!initModel) {
				await createModel();
				initModel = false;
			}

			// context
			if (context == null) {
				context = messages[channelID].last;
			}

			// make request to model
			response = (await makeRequest("/api/generate", "post", {
				model,
				prompt: userInput,
				context
			})).split("\n").filter(e => !!e).map(e => {
				return JSON.parse(e);
			});
		} catch (error) {
			if (typingInterval != null) {
				clearInterval(typingInterval);
			}
			typingInterval = null;
			throw error;
		}

		if (typingInterval != null) {
			clearInterval(typingInterval);
		}
		typingInterval = null;

		const responseText = response.map(e => e.response).filter(e => e != null).join("").trim();

		log(LogLevel.Debug, `Response: ${responseText}`);

		const prefix = messages[channelID].amount == 0 ?
			`This is the beginning of the conversation, type "${message.guild ? `<@!${client.user.id}> ` : ""}.clear" to clear the conversation.\n` : "";

		// reply (will automatically stop typing)
		const responseMessages = splitText(`${prefix}${responseText}`, 2000).map(content => ({ content, embeds: [] }));

		const replyMessages = [];
		for (let i = 0; i < responseMessages.length; ++i) {
			if (i == 0) {
				replyMessages.push(await message.reply(responseMessages[i]));
			} else {
				replyMessages.push(await message.channel.send(responseMessages[i]));
			}
		}
		const replyMessageIDs = replyMessages.map(msg => msg.id);

		// add response to conversation
		context = response.filter(e => e.done && e.context)[0].context;
		for (let i = 0; i < replyMessageIDs.length; ++i) {
			messages[channelID][replyMessageIDs[i]] = context;
		}
		messages[channelID].last = context;
	} catch (error) {
		if (typing) {
			try {
				// return error
				await message.reply({ content: `${emoji(emojis?.no, message)} Error` });
			} catch (ignored) {}
		}
		throw error;
	}
}

client.login(process.env.TOKEN);
