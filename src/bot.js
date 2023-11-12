import { Client, Events, GatewayIntentBits, MessageType, Partials } from "discord.js";
import { Logger, LogLevel } from "meklog";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const model = process.env.MODEL;
const ollamaURL = new URL(process.env.OLLAMA);
const channels = process.env.CHANNELS.split(",");

async function makeRequest(path, method, data) {
	// make a request to ollama
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

// split text so it fits in a Discord message
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

function getBoolean(str) {
	return !!str && str != "false" && str != "0";
}

function parseJSONMessage(str) {
	return str.split(/[\r\n]+/g).map(function(line) {
		const result = JSON.parse(`"${line}"`);
		if (typeof result !== "string") throw new "Invalid syntax in .env file";
		return result;
	}).join("\n");
}

const userSystemMessage = typeof process.env.SYSTEM === "string" ?
	parseJSONMessage(process.env.SYSTEM).replace(/<date>/gi, new Date().toUTCString()) : null;
const useUserSystemMessage = getBoolean(process.env.USE_SYSTEM) && !!userSystemMessage;
const useModelSystemMessage = getBoolean(process.env.USE_MODEL_SYSTEM);
let modelInfo = null;

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

		if (typeof message.content !== "string" || message.content.length == 0) {
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
		const userInput = message.content
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
			.trim();

		if (userInput == ".reset" || userInput == ".clear") {
			if (messages[channelID] == null) return;

			// reset conversation
			const cleared = messages[channelID].amount;

			// clear
			delete messages[channelID];

			if (cleared > 0) {
				await message.reply({ content: `Cleared conversation of ${cleared} messages` });
			}
			return;
		}

		if (userInput.length == 0) return;

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
			// fetch info about the model like the template and system message
			if (modelInfo == null) {
				modelInfo = (await makeRequest("/api/show", "post", {
					name: model
				}));
				if (typeof modelInfo === "string") modelInfo = JSON.parse(modelInfo);
				if (typeof modelInfo !== "object") throw "failed to fetch model information";
			}

			// context
			if (context == null) {
				context = messages[channelID].last;
			}

			let systemMessage = null;
			if (!context) {
				// only use system message on first message
				const systemMessages = [];

				if (useModelSystemMessage) {
					systemMessages.push(modelInfo.system);
				}

				if (useUserSystemMessage) {
					systemMessages.push(userSystemMessage);
				}

				// join them together
				systemMessage = systemMessages.join("\n\n");
			}

			// make request to model
			response = (await makeRequest("/api/generate", "post", {
				model: model,
				prompt: userInput,
				system: systemMessage,
				context,
			}));
			console.log(response);
			response = response.split("\n").filter(e => !!e).map(e => {
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
			`> This is the beginning of the conversation, type "${message.guild ? `<@!${client.user.id}> ` : ""}.clear" to clear the conversation.\n\n` : "";

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
				await message.reply({ content: "Error, please check the console" });
			} catch (ignored) {}
		}
		throw error;
	}
}

client.login(process.env.TOKEN);
