import { Client, Events, GatewayIntentBits, MessageType, Partials, ActivityType } from "discord.js";
import { Logger, LogLevel } from "meklog";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const model = process.env.MODEL;
const servers = process.env.OLLAMA.split(",").map(url => ({ url: new URL(url), available: true }));
const channels = process.env.CHANNELS.split(",");
const showGenerationMetrics = process.env.SHOW_GENERATION_METRICS === 'true';
const generateTitle = process.env.GENERATE_TITLE === 'true';
const titlePromptBase = process.env.TITLE_PROMPT;

function validateEnvVariables() {
    const requiredVars = ['CHANNELS', 'MODEL', 'OLLAMA', 'TOKEN'];
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

preloadModel(model).then(() => {
    console.log("Model pre-loading complete. Application is now ready to handle requests.");
}).catch(error => {
    console.error("An error occurred during model pre-loading:", error);
});

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

// Include advanced parameters from environment variables
const advancedParams = {
    options: process.env.OPTIONS ? JSON.parse(process.env.OPTIONS) : undefined, // Parse if provided
    template: getBoolean(process.env.USE_TEMPLATE) ? process.env.TEMPLATE : undefined,
    keep_alive: process.env.KEEP_ALIVE || '5m', // Default to 5 minutes if not specified
};

async function preloadModel(modelName) {
    const requestBody = {
        model: modelName,
    };

    // Assuming you have a function to select a server like in your original code
    const server = servers.find(server => server.available); // Simplified server selection
    if (!server) {
        console.error("No available servers for pre-loading the model.");
        return;
    }

    const url = new URL("/api/generate", server.url); // Using the generate endpoint as an example

    try {
        await axios({
            method: 'post',
            url: url.toString(),
            data: requestBody,
        });
        console.log(`Model ${modelName} pre-loaded successfully.`);
    } catch (error) {
        console.error(`Failed to pre-load model ${modelName}:`, error);
    }
}

async function makeRequest(path, method, data, images = []) {
    const retryDelay = parseInt(process.env.RETRY_DELAY, 10) || 1000; // Delay between retries in milliseconds
    const maxRetries = parseInt(process.env.MAX_RETRIES, 10) || 3; // Maximum number of retries for a request
    const serverUnavailableDelay = parseInt(process.env.SERVER_UNAVAILABLE_DELAY, 10) || 5000; // Delay before retrying when no servers are available

    // Normalize path
    if (!path.startsWith("/")) path = `/${path}`;

    // Enhanced server selection with load consideration (if applicable)
    const selectServer = () => servers.sort((a, b) => Number(a.available) - Number(b.available)).find(server => server.available);
	
	// Check and adjust the seed parameter
	if (advancedParams.options && advancedParams.options.seed === -1) {
		// Set to a random seed if the current value is -1
		advancedParams.options.seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
	}

    // Function to handle the actual request logic
    const attemptRequest = async (server, url, requestBody) => {
        server.available = false;
        log(LogLevel.Debug, `Making request to ${url}`);
        try {
            const response = await axios({
                method,
                url: url.toString(),
                data: requestBody,
                responseType: "json"
            });
            server.available = true;
            return response.data;
        } catch (error) {
            server.available = true; // Mark server as available again even on error
            if (error.response) {
                // The request was made and the server responded with a status code
                // that falls out of the range of 2xx
                log(LogLevel.Error, `Server responded with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
            } else if (error.request) {
                // The request was made but no response was received
                log(LogLevel.Error, "The request was made but no response was received");
            } else {
                // Something happened in setting up the request that triggered an Error
                log(LogLevel.Error, "Error", error.message);
            }
            throw error; // Re-throw the error for retry logic
        }
    };

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const server = selectServer();
        if (!server) {
            log(LogLevel.Warn, `No servers available, waiting ${serverUnavailableDelay / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, serverUnavailableDelay));
            continue;
        }

        const url = new URL(path, server.url);
        const requestBody = {
            ...data,
            ...(images.length > 0 ? { images } : {}),
            ...Object.fromEntries(Object.entries(advancedParams).filter(([_, v]) => v !== undefined))
        };

        try {
            return await attemptRequest(server, url, requestBody);
        } catch (error) {
            logError(`Attempt ${attempt + 1} failed with error: ${error.message || error.toString()}`);
            if (attempt === maxRetries - 1) {
                log(LogLevel.Error, `Request to ${url} failed after ${maxRetries} attempts.`);
                throw new Error(`Request failed after ${maxRetries} attempts: ${error.message || error.toString()}`);
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

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

    // Fetch model information if not already done
    if (modelInfo == null) {
        modelInfo = (await makeRequest("/api/show", "post", {
            name: model
        }));

        if (typeof modelInfo === "string") modelInfo = JSON.parse(modelInfo);
        if (typeof modelInfo !== "object") throw "failed to fetch model information";
    }

    // Define an array of activities based on model information
    const activities = [
        { name: `Model: ${model}`, type: ActivityType.Playing },
        { name: `Format: ${modelInfo.details.format}`, type: ActivityType.Watching },
        { name: `Family: ${modelInfo.details.family}`, type: ActivityType.Listening },
    ];

    let currentActivity = 0;

    // Function to update bot's activity
    const updateActivity = () => {
        client.user.setPresence({
            activities: [activities[currentActivity]],
            status: "online"
        });
        currentActivity = (currentActivity + 1) % activities.length; // Cycle through activities
    };

    // Update activity every X milliseconds (e.g., 5000 milliseconds = 5 seconds)
    setInterval(updateActivity, 10000);

    // Set initial activity
    updateActivity();
});

const messages = {};

// Split text so it fits in a Discord message
function splitText(text, options = {}) {
    const {
        maxLength = 2000, // Max length of each chunk
        splitChars = ['\n', ' '], // Preferred order of characters to split on
        prepend = "", // Text to prepend to chunks after the first
        append = "" // Text to append to chunks before the last
    } = options;

    text = text.toString().trim(); // Ensure text is a string and trim whitespace

    // If the initial text is within the maxLength, return it as the only chunk
    if (text.length <= maxLength) return [text];

    // Helper function to split text by a character or RegExp
    const splitByChar = (char, chunk) => {
        if (char instanceof RegExp) {
            // Splitting by RegExp, ensuring no empty strings
            return chunk.split(char).filter(Boolean);
        } else {
            // Splitting by string
            return chunk.split(char);
        }
    };

    // Split the text by each character in splitChars
    let chunks = [text];
    for (const char of splitChars) {
        if (chunks.every(chunk => chunk.length <= maxLength)) break; // All chunks are within maxLength
        chunks = chunks.flatMap(chunk => splitByChar(char, chunk));
    }

    // Ensure all chunks are within maxLength, throwing an error if not
    if (chunks.some(chunk => chunk.length > maxLength)) {
        throw new RangeError("SPLIT_MAX_LEN: Unable to split text into small enough chunks.");
    }

    // Reassemble chunks into messages, adhering to maxLength
    const messages = [];
    let currentChunk = "";
    chunks.forEach((chunk, _index) => {
        // Determine if the current chunk can fit into the current message
        if (currentChunk && (currentChunk + chunk + append + prepend).length > maxLength) {
            // Finish the current message and start a new one
            messages.push(currentChunk + append);
            currentChunk = prepend + chunk;
        } else {
            // Append the current chunk to the current message
            currentChunk += ((currentChunk ? splitChars[0] : '') + chunk);
        }
    });

    // Add the last chunk if it exists
    if (currentChunk) messages.push(currentChunk);

    return messages;
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

		// Return if not in the right channel
		const channelID = message.channel.id;
		if (message.guild && !channels.includes(channelID)) return;

		// Return if user is a bot, or non-default message
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

		// Fetch info about the model like the template and system message
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

		// Join them together
		const systemMessage = systemMessages.join("\n\n");

		// Deal with commands first before passing to LLM
		let userInput = message.content
			.replace(new RegExp("^\s*" + myMention.source, ""), "").trim();

		// May change this to slash commands in the future. I'm using regular text commands currently because the bot interacts with text content anyway
		if (userInput.startsWith(".")) {
			const args = userInput.substring(1).split(/\s+/g);
			const cmd = args.shift();
			switch (cmd) {
				case "reset":
				case "clear":
					if (messages[channelID] != null) {
						// Reset conversation
						const cleared = messages[channelID].amount;

						// Clear
						delete messages[channelID];

						if (cleared > 0) {
							await message.reply({ content: `Cleared conversation of ${cleared} messages` });
							break;
						}
					}
					await message.reply({ content: "There are no messages to clear" });
					break;
				case "help":
				case "?":
				case "h":
				case "commands":
					await message.reply({ content: "Commands:\n- `.help`, `.?`, `.h`, `.commands` for help\n- `.reset`, `.clear` to reset conversation\n- `.ping` to check responsiveness\n- `.model` for model info\n- `.template` for template info\n- `.system` for system info\n- `.license` for license info" });
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
							`**ModelFile**:\n\`\`\`${modelInfo.modelfile.replace(/`/g, "'")}\`\`\``;

						await message.reply({ content: modelDetailsMessage });
					} else {
						await message.reply({ content: "Model information is currently unavailable. Please try again later." });
					}
					break;
				case "template":
					if (modelInfo && modelInfo.template) {
						// Ensure the template string is properly escaped for Discord formatting
						const templateMessage = `**Template**:\n\`\`\`${modelInfo.template.replace(/`/g, "\\`")}\`\`\``;
						await message.reply({ content: templateMessage });
					} else {
						await message.reply({ content: "Template information is currently unavailable. Please try again later." });
					}
					break;
				case "system":
					await replySplitMessage(message, `System message:\n\n${systemMessage}`);
					break;
				case "ping":
					// Get ms difference
					const beforeTime = Date.now();
					const reply = await message.reply({ content: "Calculating ping..." });
					const afterTime = Date.now();
					const difference = afterTime - beforeTime;
					await reply.edit({ content: `Ping: ${difference}ms` });
					break;
					case "license":
						if (modelInfo && modelInfo.license) {
							const licenseInfo = "```" + modelInfo.license + "```"; // Wrap in triple back-ticks for code block formatting
							// Dynamically construct the thread name using the model name
							const threadName = `${model} - License Information`;

							// Check if the license information fits within Discord's embed description limit
							if (licenseInfo.length <= 4096) {
								// If the license information fits into one embed, send it as is
								const embed = {
									color: 0x0099ff, // Example color, change as needed
									title: `${model} - License Information`,
									description: licenseInfo,
								};
								await message.reply({ embeds: [embed] });
							} else {
								// If the license information is too long, check for or start a new thread
								let thread = message.channel.threads.cache.find(x => x.name === threadName);
								if (!thread) {
									thread = await message.startThread({
										name: threadName,
										autoArchiveDuration: 60, // Optional: Adjust auto-archive duration as needed
										reason: `License Information for ${model}`,
									});
								}

								// Split the license information into manageable parts for embeds
								const parts = splitText(modelInfo.license, { maxLength: 4000 }); // Adjust for back-ticks and embed limits
								for (const [index, part] of parts.entries()) {
									const embed = {
										color: 0x0099ff, // Example color, change as needed
										title: `${model} - License Information (Part ${index + 1} of ${parts.length})`,
										description: "```" + part + "```", // Ensure each part is wrapped in triple back-ticks
									};
									await thread.send({ embeds: [embed] });
									// Adding a slight delay to prevent rate limiting (optional, adjust as necessary)
									await new Promise(resolve => setTimeout(resolve, 500));
								}
							}
						} else {
							await message.reply({ content: "This model's license information is currently unavailable or could not be found. Please try again later." });
						}
						break;
				case "":
					break;
				default:
					await message.reply({ content: "Unknown command, type `.help`, `.?`, `.h`, or `.commands` to list all available bot commands." });
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

		// Create conversation
		if (messages[channelID] == null) {
			messages[channelID] = { amount: 0, last: null };
		}

		// Log user's message
		log(LogLevel.Debug, `${message.guild ? `#${message.channel.name}` : "DMs"} - ${message.author.username}: ${userInput}`);

		// Start typing
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
			// Context if the message is not a reply
			if (context == null) {
				context = messages[channelID].last;
			}

			if (useInitialPrompt && messages[channelID].amount == 0) {
				userInput = `${initialPrompt}\n\n${userInput}`;
				log(LogLevel.Debug, "Adding initial prompt to message");
			}

			// Make request to model
			response = (await makeRequest("/api/generate", "post", {
				model: model,
				prompt: userInput,
				images: mediaBase64,
				system: systemMessage,
				context,
				options: advancedParams.options
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
		const totalDurationSeconds = metrics.total_duration / 1e9; // Convert nanoseconds to seconds for total duration
		const loadDurationSeconds = metrics.load_duration / 1e9; // Convert nanoseconds to seconds for load duration
		const promptEvalDurationSeconds = metrics.prompt_eval_duration / 1e9; // Convert nanoseconds to seconds for prompt evaluation
		const evalDurationSeconds = metrics.eval_duration / 1e9; // Convert nanoseconds to seconds for evaluation

		// Counts
		const promptEvalCount = metrics.prompt_eval_count;
		const evalCount = metrics.eval_count;

		// Calculate percentages of total duration for prompt evaluation and response generation
		const promptEvalPercentage = ((promptEvalDurationSeconds / totalDurationSeconds) * 100).toFixed(2);
		const responseGenPercentage = ((evalDurationSeconds / totalDurationSeconds) * 100).toFixed(2);

		// Calculate Load Time Percentage if load duration is not zero
		const loadTimePercentage = loadDurationSeconds > 0 ? ((loadDurationSeconds / totalDurationSeconds) * 100).toFixed(2) : "0.00";

		// Calculate tokens per second based on evaluation count and evaluation duration
		const tokensPerSecond = evalCount / evalDurationSeconds;

		// Format total duration
		const formattedTotalDuration = `${totalDurationSeconds.toFixed(2)}s`;

		// Check if it's the first message to the bot in this channel
		const isFirstMessage = messages[channelID].amount === 0;

		// Prepare the additionalInfo string
		const additionalInfo = showGenerationMetrics ? 
		`> **Total Duration**: \`${formattedTotalDuration}\` (\`${tokensPerSecond.toFixed(2)}\` tok/s)\n` +
		`${(isFirstMessage && loadDurationSeconds.toFixed(2) !== '0.00') ? `> **Model Load Time**: \`${loadDurationSeconds.toFixed(2)}s\`, (\`${loadTimePercentage}%\`)\n` : ''}` +
		`> **Prompt Evaluation**: \`${promptEvalCount}\` counts, \`${promptEvalDurationSeconds.toFixed(2)}s\`, (\`${promptEvalPercentage}%\`)\n` +
		`> **Response Generation**: \`${evalCount}\` counts, \`${evalDurationSeconds.toFixed(2)}s\`, (\`${responseGenPercentage}%\`)` : "";

        // Generate a header for the response based on the generated response
		let header = ""; // Initialize an empty header
		if (generateTitle) {
			try {
				const fullPrompt = `${titlePromptBase}:${userInput}`;
				console.log(`Making title generation request with prompt: ${fullPrompt}`);

				const headerResponse = await makeRequest("/api/generate", "post", {
					model: model,
					prompt: fullPrompt,
					stream: false,
					options: {
					num_predict: 15,
					top_p: 0.1,
					repeat_penalty: 1.3,
					seed: -1
				}
				});

				if (headerResponse && headerResponse.response) {
					// Format the title as needed, then prepend to the response text
					let title = headerResponse.response.replace(/^"|"$/g, '').trim();

					// Post-processing step to handle incomplete sentence endings
					const endsWithIncompletePunctuation = /[,;:]$/;
					if (endsWithIncompletePunctuation.test(title)) {
						title = title.replace(/[,;:]$/, '...'); // Replace the ending punctuation with an ellipsis
					}

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
			"> This is the beginning of the conversation, type `.help`, `.?`, `.h`, or `.commands` for help.\n\n" : "";

		// Include the additional information in the reply
		const replyMessageIDs = (await replySplitMessage(message, `${prefix}${finalResponseText}\n\n${additionalInfo}`)).map(msg => msg.id);
		
		if (typingInterval != null) {
			clearInterval(typingInterval);
		}
		typingInterval = null;

		// Add response to conversation
		context = response.filter(e => e.done && e.context)[0].context;
		for (let i = 0; i < replyMessageIDs.length; ++i) {
			messages[channelID][replyMessageIDs[i]] = context;
		}
		messages[channelID].last = context;
		++messages[channelID].amount;
	} catch (error) {
		if (typing) {
			try {
				// Return error
				await message.reply({ content: "Error, please check the console" });
			} catch (ignored) {}
		}
		logError(error);
	}
});

client.login(process.env.TOKEN);