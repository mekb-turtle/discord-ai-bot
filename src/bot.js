import { Client, Events, GatewayIntentBits, MessageType, Partials, ActivityType } from "discord.js";
import { Logger, LogLevel } from "meklog";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const model = process.env.MODEL;
const servers = process.env.OLLAMA.split(",").map(url => ({ url: new URL(url), available: true }));
const channels = process.env.CHANNELS.split(",");
const showGenerationMetrics = process.env.SHOW_GENERATION_METRICS === 'true';
const generateTitle = process.env.GENERATE_TITLE === 'true';
const titlePromptBase = process.env.TITLE_PROMPT;

function validateEnvVariables() {
    const requiredVars = ['TOKEN', 'MODEL', 'OLLAMA', 'CHANNELS'];
    const missingVars = requiredVars.filter(key => !process.env[key]);
    if (missingVars.length > 0) {
        console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
        process.exit(1);
    }
}
validateEnvVariables();

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

async function makeRequest(path, method, data, images = []) {
    const retryDelay = parseInt(process.env.RETRY_DELAY, 10) || 1000; // Delay between retries in milliseconds
    const maxRetries = parseInt(process.env.MAX_RETRIES, 10) || 3; // Maximum number of retries for a request
    const serverUnavailableDelay = parseInt(process.env.SERVER_UNAVAILABLE_DELAY, 10) || 5000; // Delay before retrying when no servers are available

    // Normalize path
    if (!path.startsWith("/")) path = `/${path}`;

    // Enhanced server selection with load consideration (if applicable)
    const selectServer = () => servers.sort((a, b) => Number(a.available) - Number(b.available)).find(server => server.available);

    // Include advanced parameters from environment variables
    const advancedParams = {
        options: process.env.OPTIONS ? JSON.parse(process.env.OPTIONS) : undefined, // Parse if provided
        template: getBoolean(process.env.USE_TEMPLATE) ? process.env.TEMPLATE : undefined,
        keep_alive: process.env.KEEP_ALIVE || '5m', // Default to 5 minutes if not specified
    };
	
	// Check and adjust the seed parameter
	if (advancedParams.options && advancedParams.options.seed === -1) {
		// Set to a random seed if the current value is -1
		advancedParams.options.seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
		advancedParams.options.seed = advancedParams.options.seed.toLocaleString("fullwide", {useGrouping: false});
	}

    // Function to handle the actual request logic
    const attemptRequest = async (server, url, requestBody) => {
        server.available = false; // Mark server as busy
        log(LogLevel.Debug, `Making request to ${url}`);
        const response = await axios({
            method,
            url: url.toString(),
            data: requestBody,
            responseType: "json" // Assuming JSON response for better handling
        });
        server.available = true; // Mark server as available again
        return response.data;
    };

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const server = selectServer();
        if (!server) {
            log(LogLevel.Warn, `No servers available, waiting ${serverUnavailableDelay / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, serverUnavailableDelay));
            continue; // Skip this attempt, wait for server availability
        }

        const url = new URL(path, server.url); // Construct full URL
        // Merge the basic data with images and advanced parameters, excluding undefined values
        const requestBody = {
            ...data,
            ...(images.length > 0 ? { images } : {}),
            ...Object.fromEntries(Object.entries(advancedParams).filter(([_, v]) => v !== undefined && v !== 'false'))
        };

        try {
            return await attemptRequest(server, url, requestBody);
        } catch (error) {
            server.available = true; // Ensure server is marked available even on error
            logError(`Attempt ${attempt + 1} failed with error: ${error.message}`);

            if (attempt === maxRetries - 1) {
                // Log final failure and throw error
                log(LogLevel.Error, `Request to ${url} failed after ${maxRetries} attempts.`);
                throw new Error(`Request failed after ${maxRetries} attempts: ${error.message}`);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    // If the function hasn't returned by now, it means all retries have been exhausted
    throw new Error("Unable to make request, all retries failed.");
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

client.once(Events.ClientReady, async () => {
	await client.guilds.fetch();
	client.user.setPresence({
		activities: [{
			name: "G30 is cool",
			type: ActivityType.Listening
		}],
		status: "online" 
	});
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
			// prioritize splitting by newlines over other whitespaces
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
  return str.split(/[\r\n]+/g).map(function(line) {
    // Attempt to parse each line as JSON after escaping necessary characters
    try {
      // Escape backslashes and double quotes in the line
      const escapedLine = line.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const result = JSON.parse(`"${escapedLine}"`);
      if (typeof result !== "string") {
        throw new Error("Line is not a valid string after JSON parsing.");
      }
      return result;
    } catch (error) {
      // Throw a more descriptive error with the problematic line
      throw new Error(`Invalid syntax in input: "${line}" - ${error.message}`);
    }
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
let modelInfo = null;
const initialPrompt = parseEnvString(process.env.INITIAL_PROMPT);
const useInitialPrompt = getBoolean(process.env.USE_INITIAL_PROMPT) && !!initialPrompt;

const requiresMention = getBoolean(process.env.REQUIRES_MENTION);

async function replySplitMessage(replyMessage, content) {
	const responseMessages = splitText(content, 2000).map(content => ({ content }));

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
		if (message.author.bot) return;

		const botRole = message.guild?.members?.me?.roles?.botRole;
		const myMention = new RegExp(`<@((!?${client.user.id}${botRole ? `)|(&${botRole.id}` : ""}))>`, "g"); // RegExp to match a mention for the bot

		if (typeof message.content !== "string" || message.content.length == 0) {
			return;
		}

		const attachments = message.attachments.filter(attachment => attachment.contentType?.startsWith('image/') || attachment.contentType?.startsWith('video/'));
		const mediaBase64 = await Promise.all(attachments.map(async attachment => {
			const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
			return Buffer.from(response.data, 'binary').toString('base64');
		}));

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
			.replace(new RegExp("^\s*" + myMention.source, ""), "").trim();

		// may change this to slash commands in the future
		// I'm using regular text commands currently because the bot interacts with text content anyway
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
					await message.reply({ content: "Commands:\n- `.reset` `.clear`\n- `.help` `.?` `.h`\n- `.ping`\n- `.model`\n- `.system`\n- `.license`" });
					break;
				case "model":
					if (modelInfo && typeof modelInfo === 'object') {
						// Extracting model details
						const details = modelInfo.details;
						// Preparing the message
						const modelDetailsMessage = `**Model Name**: ${model}\n` +
							`**Format**: ${details.format}\n` +
							`**Family**: ${details.family}\n` +
							`**Parameter Size**: ${details.parameter_size}\n` +
							`**Quantization Level**: ${details.quantization_level}\n` +
							`**Template**: \`${modelInfo.template.replace(/`/g, "\\`")}\`\n` +
							`**ModelFile**:\n\`\`\`${modelInfo.modelfile.replace(/`/g, "'")}\`\`\``;

						await message.reply({ content: modelDetailsMessage });
					} else {
						await message.reply({ content: "Model information is currently unavailable. Please try again later." });
					}
					break;
				case "system":
					await replySplitMessage(message, `System message:\n\n${systemMessage}`);
					break;
				case "ping":
					// get ms difference
					const beforeTime = Date.now();
					const reply = await message.reply({ content: "Ping" });
					const afterTime = Date.now();
					const difference = afterTime - beforeTime;
					await reply.edit({ content: `Ping: ${difference}ms` });
					break;
					case "license":
						// Check if modelInfo has license information
						if (modelInfo && modelInfo.license) {
							const licenseInfo = modelInfo.license;
							// Ensure the license information fits within Discord's embed description limit
							const maxEmbedDescriptionLength = 4096; // Max length for embed description

							if (licenseInfo.length <= maxEmbedDescriptionLength) {
								// If the license information fits into one embed, send it as is
								const embed = {
									color: 0x0099ff, // Example color, change as needed
									title: 'License Information',
									description: licenseInfo,
								};
								await message.reply({ embeds: [embed] });
							} else {
								// If the license information is too long, consider providing a concise summary or a link to the full text
								await message.reply({ content: "License information is too long to display here. Please refer to the documentation for the full license text." });
							}
						} else {
							await message.reply({ content: "License information is currently unavailable. Please try again later." });
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
				if (typingInterval != null) {
					clearInterval(typingInterval);
				}
				typingInterval = null;
			}
		}, 7000);

        log(LogLevel.Debug, `Generating response for: ${userInput}`);

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
				context,
				images: mediaBase64
			}));

			if (typeof response != "string") {
				log(LogLevel.Debug, response);
				throw new TypeError("Response is not a string. This may be an error with Ollama.");
			}
			
			response = response.split("\n").filter(e => !!e).map(e => {
				return JSON.parse(e);
			});
		} catch (error) {
			if (typingInterval != null) {
				clearInterval(typingInterval);
			}
			typingInterval = null;
			log(LogLevel.Error, `Failed to generate response for: ${userInput}, Error: ${error}`);
			throw error;
		}

		let responseText = response.map(e => e.response).filter(e => e != null).join("").trim();
		if (responseText.length == 0) {
			responseText = "(No response)";
		}

		// Extract additional metrics from the last element of the response array
		const metrics = response[response.length - 1];
		const totalDurationSeconds = metrics.total_duration / 1e9; // Convert nanoseconds to seconds
		const evalCount = metrics.eval_count;
		const evalDurationSeconds = metrics.eval_duration / 1e9; // Convert nanoseconds to seconds
		const tokensPerSecond = evalCount / evalDurationSeconds;

		// Format total duration into minutes and seconds
		const totalMinutes = Math.floor(totalDurationSeconds / 60);
		const totalSeconds = Math.floor(totalDurationSeconds % 60);
		const formattedTotalDuration = `${totalMinutes > 0 ? `${totalMinutes}m ` : ""}${totalSeconds}s`;

		// Prepare the additional information string
		const additionalInfo = showGenerationMetrics ? `> Response generated in ${formattedTotalDuration} (\`${tokensPerSecond.toFixed(2)}\` tok/s)` : "";
		
        // Generate a header for the response based on the generated response
		let header = ""; // Initialize an empty header
		if (generateTitle) {
			try {
				const fullPrompt = `${titlePromptBase} ${userInput}`;
				console.log(`Making title generation request with prompt: ${fullPrompt}`);

				const headerResponse = await makeRequest("/api/generate", "post", {
					model: model,
					prompt: fullPrompt,
					stream: false
				});

				if (headerResponse && headerResponse.response) {
					// Format the title as needed, then prepend to the response text
					const title = headerResponse.response.replace(/^"|"$/g, '').trim();
					header = `**${title}**\n\n`; // Format the header as bold for Discord
				} else {
					log(LogLevel.Warn, "Header response did not contain expected data.");
				}
			} catch (error) {
				log(LogLevel.Error, `Failed to generate header for: ${userInput}, Error: ${error}`);
				// Proceed without a header if there's an error
			}
		}

		// Now prepend the generated title (header) to the response text
		let finalResponseText = `${header}${responseText}`;

		log(LogLevel.Debug, `Response: ${header}${responseText}`);
		log(LogLevel.Debug, additionalInfo); // Log the additional metrics

		const prefix = showStartOfConversation && messages[channelID].amount == 0 ?
			"> This is the beginning of the conversation, type `.help` for help.\n\n" : "";

		// Include the additional information in the reply
		const replyMessageIDs = (await replySplitMessage(message, `${prefix}${finalResponseText}\n\n${additionalInfo}`)).map(msg => msg.id);
		
		if (typingInterval != null) {
			clearInterval(typingInterval);
		}
		typingInterval = null;

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
			} catch (ignored) {}
		}
		logError(error);
	}
});

client.login(process.env.TOKEN);