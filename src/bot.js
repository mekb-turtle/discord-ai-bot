import {
	Client,
	Events,
	GatewayIntentBits,
	MessageType,
	Partials,
	REST,
	Routes
} from "discord.js";
import { Logger, LogLevel } from "meklog";
import dotenv from "dotenv";
import axios from "axios";
import commands from "./commands/commands.js";

dotenv.config();

const model = process.env.MODEL;
const servers = process.env.OLLAMA.split(",").map(url => ({ url: new URL(url), available: true }));
const stableDiffusionServers = process.env.STABLE_DIFFUSION.split(",").map(url => ({ url: new URL(url), available: true }));
const channels = process.env.CHANNELS.split(",");

if (servers.length == 0) {
	throw new Error("No servers available");
}

let log;
process.on("message", data => {
	if (data.shardID) client.shardID = data.shardID;
	if (data.logger) log = new Logger(data.logger);
});

const logError = (error) => {
	if (error.response) {
		let str = `Error ${error.response.status} ${error.response.statusText}: ${error.request.method} ${error.request.path}`;
		if (error.response.data?.error) {
			str += ": " + error.response.data.error;
		}
		log(LogLevel.Error, str);
	} else {
		log(LogLevel.Error, error);
	}
};

function shuffleArray(array) {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
	return array;
}

async function makeRequest(path, method, data) {
	while (servers.filter(server => server.available).length == 0) {
		// wait until a server is available
		await new Promise(res => setTimeout(res, 1000));
	}

	let error = null;
	// randomly loop through the servers available, don't shuffle the actual array because we want to be notified of any updates
	let order = new Array(servers.length).fill().map((_, i) => i);
	if (randomServer) order = shuffleArray(order);
	for (const j in order) {
		if (!order.hasOwnProperty(j)) continue;
		const i = order[j];
		// try one until it succeeds
		try {
			// make a request to ollama
			if (!servers[i].available) continue;
			const url = new URL(servers[i].url); // don't modify the original URL

			servers[i].available = false;

			if (path.startsWith("/")) path = path.substring(1);
			if (!url.pathname.endsWith("/")) url.pathname += "/"; // safety
			url.pathname += path;
			log(LogLevel.Debug, `Making request to ${url}`);
			const result = await axios({
				method, url, data,
				responseType: "text"
			});
			servers[i].available = true;
			return result.data;
		} catch (err) {
			servers[i].available = true;
			error = err;
			logError(error);
		}
	}
	if (!error) {
		throw new Error("No servers available");
	}
	throw error;
}

async function makeStableDiffusionRequest(path, method, data) {
	while (stableDiffusionServers.filter(server => server.available).length == 0) {
		// wait until a server is available
		await new Promise(res => setTimeout(res, 1000));
	}

	let error = null;
	// randomly loop through the servers available, don't shuffle the actual array because we want to be notified of any updates
	let order = new Array(stableDiffusionServers.length).fill().map((_, i) => i);
	if (randomServer) order = shuffleArray(order);
	for (const j in order) {
		if (!order.hasOwnProperty(j)) continue;
		const i = order[j];
		// try one until it succeeds
		try {
			// make a request to stable diffusion
			if (!stableDiffusionServers[i].available) continue;
			const url = new URL(stableDiffusionServers[i].url); // don't modify the original URL

			stableDiffusionServers[i].available = false;

			if (path.startsWith("/")) path = path.substring(1);
			if (!url.pathname.endsWith("/")) url.pathname += "/"; // safety
			url.pathname += path;
			log(LogLevel.Debug, `Making stable diffusion request to ${url}`);
			const result = await axios({
				method, url, data
			});
			stableDiffusionServers[i].available = true;
			return result.data;
		} catch (err) {
			stableDiffusionServers[i].available = true;
			error = err;
			logError(error);
		}
	}
	if (!error) {
		throw new Error("No servers available");
	}
	throw error;
}

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

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once(Events.ClientReady, async () => {
	await client.guilds.fetch();
	client.user.setPresence({ activities: [], status: "online" });
	await rest.put(Routes.applicationCommands(client.user.id), {
		body: commands
	});

	log(LogLevel.Info, "Successfully reloaded application slash (/) commands.");
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
	return !!str && str != "false" && str != "no" && str != "off" && str != "0";
}

function parseJSONMessage(str) {
	return str.split(/[\r\n]+/g).map(line => {
		const result = JSON.parse(`"${line}"`);
		if (typeof result !== "string") throw new "Invalid syntax in .env file";
		return result;
	}).join("\n");
}

function parseEnvString(str) {
	return typeof str === "string" ?
		parseJSONMessage(str).replace(/<date>/gi, new Date().toUTCString()) : null;
}

const customSystemMessage = parseEnvString(process.env.SYSTEM);
const useCustomSystemMessage = getBoolean(process.env.USE_SYSTEM) && !!customSystemMessage;
const useModelSystemMessage = getBoolean(process.env.USE_MODEL_SYSTEM);
const showStartOfConversation = getBoolean(process.env.SHOW_START_OF_CONVERSATION);
const randomServer = getBoolean(process.env.RANDOM_SERVER);
let modelInfo = null;
const initialPrompt = parseEnvString(process.env.INITIAL_PROMPT);
const useInitialPrompt = getBoolean(process.env.USE_INITIAL_PROMPT) && !!initialPrompt;

const requiresMention = getBoolean(process.env.REQUIRES_MENTION);

async function replySplitMessage(replyMessage, content) {
	const responseMessages = splitText(content, 2000).map(text => ({ content: text }));

	const replyMessages = [];
	for (let i = 0; i < responseMessages.length; ++i) {
		if (i == 0) {
			replyMessages.push(await replyMessage.reply(responseMessages[i]));
		} else {
			replyMessages.push(await replyMessage.channel.send(responseMessages[i]));
		}
	}
	return replyMessages;
}

client.on(Events.MessageCreate, async message => {
	let typing = false;
	try {
		await message.fetch();

		// return if not in the right channel
		const channelID = message.channel.id;
		if (message.guild && !channels.includes(channelID)) return;

		// return if user is a bot, or non-default message
		if (!message.author.id) return;
		if (message.author.bot || message.author.id == client.user.id) return;

		const botRole = message.guild?.members?.me?.roles?.botRole;
		const myMention = new RegExp(`<@((!?${client.user.id}${botRole ? `)|(&${botRole.id}` : ""}))>`, "g"); // RegExp to match a mention for the bot

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
		} else if (message.type != MessageType.Default) {
			return;
		}

		// fetch info about the model like the template and system message
		if (modelInfo == null) {
			modelInfo = (await makeRequest("/api/show", "post", {
				name: model
			}));
			if (typeof modelInfo === "string") modelInfo = JSON.parse(modelInfo);
			if (typeof modelInfo !== "object") throw "failed to fetch model information";
		}

		const systemMessages = [];

		if (useModelSystemMessage && modelInfo.system) {
			systemMessages.push(modelInfo.system);
		}

		if (useCustomSystemMessage) {
			systemMessages.push(customSystemMessage);
		}

		// join them together
		const systemMessage = systemMessages.join("\n\n");

		// deal with commands first before passing to LLM
		let userInput = message.content
			.replace(new RegExp("^s*" + myMention.source, ""), "").trim();

		// may change this to slash commands in the future
		// i'm using regular text commands currently because the bot interacts with text content anyway
		if (userInput.startsWith(".")) {
			const args = userInput.substring(1).split(/\s+/g);
			const cmd = args.shift();
			switch (cmd) {
				case "reset":
				case "clear":
					if (messages[channelID] != null) {
						// reset conversation
						const cleared = messages[channelID].amount;

						// clear
						delete messages[channelID];

						if (cleared > 0) {
							await message.reply({ content: `Cleared conversation of ${cleared} messages` });
							break;
						}
					}
					await message.reply({ content: "No messages to clear" });
					break;
				case "help":
				case "?":
				case "h":
					await message.reply({ content: "Commands:\n- `.reset` `.clear`\n- `.help` `.?` `.h`\n- `.ping`\n- `.model`\n- `.system`" });
					break;
				case "model":
					await message.reply({
						content: `Current model: ${model}`
					});
					break;
				case "system":
					await replySplitMessage(message, `System message:\n\n${systemMessage}`);
					break;
				case "ping":
					// get ms difference
					try {
						const beforeTime = Date.now();
						const reply = await message.reply({ content: "Ping" });
						const afterTime = Date.now();
						const difference = afterTime - beforeTime;
						await reply.edit({ content: `Ping: ${difference}ms` });
					} catch (error) {
						logError(error);
						await message.reply({ content: "Error, please check the console" });
					}
					break;
				case "":
					break;
				default:
					await message.reply({ content: "Unknown command, type `.help` for a list of commands" });
					break;
			}
			return;
		}

		if (message.type == MessageType.Default && (requiresMention && message.guild && !message.content.match(myMention))) return;

		if (message.guild) {
			await message.guild.channels.fetch();
			await message.guild.members.fetch();
		}

		userInput = userInput
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
				logError(error);
				if (typingInterval != null) {
					clearInterval(typingInterval);
				}
				typingInterval = null;
			}
		}, 7000);

		let response;
		try {
			// context if the message is not a reply
			if (context == null) {
				context = messages[channelID].last;
			}

			if (useInitialPrompt && messages[channelID].amount == 0) {
				userInput = `${initialPrompt}\n\n${userInput}`;
				log(LogLevel.Debug, "Adding initial prompt to message");
			}

			// make request to model
			response = (await makeRequest("/api/generate", "post", {
				model: model,
				prompt: userInput,
				system: systemMessage,
				context
			}));

			if (typeof response != "string") {
				log(LogLevel.Debug, response);
				throw new TypeError("response is not a string, this may be an error with ollama");
			}

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

		let responseText = response.map(e => e.response).filter(e => e != null).join("").trim();
		if (responseText.length == 0) {
			responseText = "(No response)";
		}

		log(LogLevel.Debug, `Response: ${responseText}`);

		const prefix = showStartOfConversation && messages[channelID].amount == 0 ?
			"> This is the beginning of the conversation, type `.help` for help.\n\n" : "";

		// reply (will automatically stop typing)
		const replyMessageIDs = (await replySplitMessage(message, `${prefix}${responseText}`)).map(msg => msg.id);

		// add response to conversation
		context = response.filter(e => e.done && e.context)[0].context;
		for (let i = 0; i < replyMessageIDs.length; ++i) {
			messages[channelID][replyMessageIDs[i]] = context;
		}
		messages[channelID].last = context;
		++messages[channelID].amount;
	} catch (error) {
		if (typing) {
			try {
				// return error
				await message.reply({ content: "Error, please check the console" });
			} catch (ignored) {
				logError(ignored);
			}
		}
		logError(error);
	}
});

client.on(Events.InteractionCreate, async (interaction) => {
	if (!interaction.isCommand()) return;

	const { commandName, options } = interaction;

	switch (commandName) {
		case "text2img":
			try {
				const prompt = options.getString("prompt");
				const width = options.getNumber("width") || 256;
				const height = options.getNumber("height") || 256;
				const steps = options.getNumber("steps") || 10;
				const batch_count = options.getNumber("batch_count") || 1;
				const batch_size = options.getNumber("batch_size") || 1;
				const enhance_prompt = (options.getBoolean("enhance_prompt") && true) ? "yes" : "no";

				await interaction.deferReply();
				const stableDiffusionResponse = await makeStableDiffusionRequest(
					"/sdapi/v1/txt2img",
					"post",
					{
						prompt,
						width,
						height,
						steps,
						num_inference_steps: steps,
						batch_count,
						batch_size,
						enhance_prompt
					}
				);
				const images = stableDiffusionResponse.images.map((image) =>
					Buffer.from(image, "base64")
				);
				await interaction.editReply({
					content: `Here are images from prompt \`${prompt}\``,
					files: images
				});
			} catch (error) {
				logError(error);
				await interaction.editReply({
					content: "Error, please check the console"
				});
			}
			break;
	}
});

client.login(process.env.TOKEN);
