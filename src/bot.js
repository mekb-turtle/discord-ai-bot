import { Client, Events, GatewayIntentBits, MessageType, PermissionsBitField } from "discord.js";
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

const client = new Client({ intents: [
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.MessageContent
], allowedMentions: { users: [], roles: [], repliedUser: false } });

client.once(Events.ClientReady, async () => {
	await client.guilds.fetch();
	client.user.setPresence({ activities: [], status: "online" });
});

const messages = {};
const messagesIDMapped = {};

function getSystemMessage() {
	// feel free to change
	return `
The current date and time is ${new Date().toUTCString()}.

Basic markdown is supported.
Bold is done by surrounding text in two asterisks, e.g **bold text here**. Italics is done by surrounding text in one underline, e.g _italics text here_. Underline is done by surrounding text in two underlines, e.g __underlined text here__. Strikethrough is done by surrounding text in two tildes, e.g ~~strikethrough text here~~. Spoiler text is done by surrounding text in two pipes, e.g ||spoilered text here||.
Block quotes are supported by starting the line with > followed by a space, e.g > Hello.
Inline code blocks are supported by surrounding text in backticks, e.g ${"`"}print("Hello");${"`"}, block code is supported by surrounding text in three backticks, e.g ${"```"}print("Hello");${"```"}.
Headers are supported by starting the line with #, ##, or ### followed by a space, e.g # Header. # provides the largest text, and ### provides the smallest text.
Surround code that is produced in code blocks. Use a code block with three backticks if the code has multiple lines, otherwise use an inline code block with one backtick.
Lists are supported by starting the line with a dash followed by a space, e.g - List
Numbered lists are supported by starting the line with a number followed by a dot and a space, e.g 1. List.
Images, links, tables, LaTeX, and anything else is not supported.
If you need to use the symbols |, _, *, ~, @, #, :, put a backslash before them.
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
	} catch (err) {}

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
	} catch (err) {
		writeStream.close();
		await cleanup();
		throw err;
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

		if (!message.guild) return;

		// return if not in the right channel, a bot, or non-default message
		const channelID = message.channel.id;
		if (!channels.includes(channelID)) return;

		if (!message.author.id) return;
		if (message.author.bot) return;

		const myMention = new RegExp(`<@!?${client.user.id}>`, "g");

		if (typeof message.content != "string" || message.content.length == 0) {
			return;
		}

		let context = null;
		if (message.type == MessageType.Reply) {
			const reply = await message.fetchReference();
			if (!reply) return;
			if (message.author.id != client.user.id) return;
			context = messagesIDMapped[channelID][message.id];
			if (!context) context = null;
		} else if (message.type != MessageType.Default || !message.content.match(myMention)) {
			return;
		}

		const userInput = message.content.replace(myMention, "").trim();

		if (userInput == ".reset") {
			if (!messages[channelID]) return;

			// reset conversation
			const cleared = messages[channelID].length;

			// clear
			delete messages[channelID];
			delete messagesIDMapped[channelID];

			await message.reply({ content: `${emoji(emojis?.yes, message)} Cleared conversation of ${cleared} messages` });
			return;
		}

		// create conversation
		if (!messages[channelID]) {
			messages[channelID] = [];
			messagesIDMapped[channelID] = {};
		}

		// start typing
		typing = true;
		await message.channel.sendTyping();
		const typingInterval = setInterval(async () => {
			await message.channel.sendTyping();
		}, 7000);

		if (!initModel) {
			await createModel();
			initModel = false;
		}

		// add user's message to conversation
		log(LogLevel.Debug, `#${message.channel.name} - ${message.author.username}: ${userInput}`);

		// context
		const messagesLength = messages[channelID].length;
		if (messagesLength > 0 && context == null) {
			context = messages[channelID][messagesLength - 1].context;
		}

		let response;
		try {
			// make request to model
			response = (await makeRequest("/api/generate", "post", {
				model,
				prompt: userInput,
				context
			})).split("\n").filter(e => !!e).map(e => {
				return JSON.parse(e);
			});
		} catch (err) {
			clearInterval(typingInterval);
			throw err;
		}

		clearInterval(typingInterval);

		const responseText = response.map(e => e.response).filter(e => e != null).join("");

		log(LogLevel.Debug, `Response: ${responseText}`);

		// reply (will automatically stop typing)
		const replyMessage = await message.reply({ content: responseText });

		// add response to conversation
		context = response.filter(e => e.done && e.context)[0].context;
		messages[channelID].push({ messageID: replyMessage.id, context });
		messagesIDMapped[channelID][replyMessage.id] = context;
	} catch (error) {
		if (typing) {
			// return error
			await message.reply({ content: `${emoji(emojis?.no, message)} Error` });
		}
		throw error;
	}
}

client.login(process.env.TOKEN);
