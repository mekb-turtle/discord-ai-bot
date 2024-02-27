<div align="center">
    <h1><a href="#"></a>Discord AI Bot</h1>
    <h3 align="center"><a href="#"></a>Discord bot to interact with <a href="https://github.com/jmorganca/ollama">Ollama</a> as a chatbot</h3>
    <h3><a href="#"></a><img alt="Stars" src="https://img.shields.io/github/stars/mekb-turtle/discord-ai-bot?display_name=tag&style=for-the-badge" /></h3>
    <h3><a href="#"></a><img alt="Discord chat with the bot" src="assets/screenshot.png" /></h3>
</div>

## Overview
This project integrates a Discord bot with the Ollama API to provide an interactive chatbot experience. Users can interact with the bot in designated channels by mentioning it, enabling dynamic conversations powered by advanced AI models.

## Set-up Instructions

### Prerequisites
Before starting, ensure you have the following:
- **Node.js**: Install Node.js version 14 or higher. Node.js is essential for running JavaScript on the server. [Download Node.js](https://nodejs.org)
- **Ollama**: This project uses Ollama for AI model serving. Follow the installation instructions on the [Ollama GitHub page](https://github.com/jmorganca/ollama).

### Basic Setup
1. **Clone the Repository**: Start by cloning this repository to your local machine using `git clone`, followed by the repository URL.
2. **Install Dependencies**: Navigate to the cloned repository's directory in your terminal and run `npm install` to install all required dependencies.
3. **Model Setup**: Pull your desired AI model using Ollama. For example, use `ollama pull orca` or `ollama pull llama2` to download specific models. This step requires Ollama to be installed and properly configured on your system.
4. **Start Ollama**: With your model downloaded, start the Ollama server by running `ollama serve`. This command initializes the model server, making it ready to handle requests from your Discord bot.

### Discord Bot Configuration
1. **Create a Discord Bot**: Visit the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application. Navigate to the "Bot" section and add a new bot to your application.
2. **Configure Intents**: Enable both the "Message Content Intent" and "Server Members Intent" to allow your bot to read message content and access server member information.
3. **Invite the Bot to Your Server**:
    - In the Discord Developer Portal, go to "Application" > "OAuth2" > "URL Generator".
    - Select the "bot" scope and permissions "Send Messages", "Read Messages/View Channels", and "Read Message History".
    - Copy the generated URL, paste it into your web browser, and follow the prompts to invite your bot to a server.

### Environment Configuration
1. **Environment Variables**: Rename the `.env.example` file to `.env`. This file contains environment variables crucial for configuring your bot's behavior.
2. **Configure `.env` Variables**: Edit the `.env` file with your preferred text editor and update the variables:
    - `TOKEN`: Your Discord bot token, found in the Discord Developer Portal under "Bot" > "Token".
    - `CHANNELS`: The IDs of the Discord channels you want the bot to listen to. Enable Developer Mode in Discord under User Settings > Advanced to copy IDs.
    - `OLLAMA`: The URL(s) of your Ollama server(s), separated by commas if using multiple.
    - `MODEL`: The identifier for the AI model you wish to use with the bot. This should match one of the models you have pulled and are serving with Ollama.
    - Additional variables as described in the `.env Variables` section of the README.

### Starting the Bot
1. **Launch**: With all configurations in place, start your bot by running `npm start` in the terminal. Your bot should now be online and responsive in the specified Discord channels.

### Docker Setup (Optional)
For users who prefer Docker for deployment, follow these steps to ensure a smooth setup:

1. **Install Docker**: First, make sure Docker and Docker Compose are installed on your machine. Your Docker Engine should be at least version 1.13.0+, compatible with Docker Compose version 3 or higher. This compatibility is crucial for running the Dockerized version of the bot without issues. [Download and install Docker here](https://docs.docker.com/get-docker/).

2. **Pre-Setup Checks**: Before proceeding with Docker, complete the initial setup steps mentioned in the Basic Setup and Discord Bot Configuration sections. This includes cloning the repository, setting up your `.env` file, and ensuring your AI model is pulled and ready.

3. **Starting the Bot with Docker**:
    - **With Make**: If you have Make installed, you can simplify the Docker Compose process. Navigate to your project directory in the terminal and run the following command:
      ```
      make compose-up
      ```
      This command utilizes a Makefile to run Docker Compose commands, streamlining the process of building and starting the bot.
      
    - **Without Make**: If you do not have Make installed, you can directly use Docker Compose to start the bot. Ensure you're in the project directory and run:
      ```
      docker compose -p discord-ai up
      ```
      This command tells Docker Compose to start the services defined in your `docker-compose.yml` file under the project name `discord-ai`.

By following these Docker setup instructions, you can deploy the Discord AI Bot in a Docker container, leveraging Docker's environment consistency and ease of deployment. Remember, running the bot with Docker means you won't use `npm start`; instead, Docker handles the process of bringing your bot online.

### Final Steps
After completing the setup, your Discord AI Bot is ready. You can begin interacting with the bot by mentioning it in a message or sending a message within the configured channels. The bot will respond based on the AI model's capabilities, the .env file configuration, and the provided queries.

## .env Variables
| Variable                      | Description                                                  |
|-------------------------------|--------------------------------------------------------------|
| `TOKEN`                       | Discord bot token.                                           |
| `CHANNELS`                    | IDs of channels the bot listens to, comma-separated.         |
| `OLLAMA`                      | Comma-separated URLs of Ollama servers.                      |
| `MODEL`                       | Ollama model name for the bot to use.                        |
| `OPTIONS`                     | JSON string of options for API requests.                     |
| `SYSTEM`                      | System message for LLM requests.                             |
| `TEMPLATE`                    | Template for formatting LLM requests.                        |
| `INITIAL_PROMPT`              | Initial prompt for starting conversations.                   |
| `TITLE_PROMPT`                | Prompt for generating response titles.                       |
| `USE_SYSTEM`                  | Enable/disable system message (`true`/`false`).              |
| `USE_MODEL_SYSTEM`            | Enable/disable model's default system message (`true`/`false`).|
| `USE_TEMPLATE`                | Enable/disable template usage (`true`/`false`).              |
| `USE_INITIAL_PROMPT`          | Enable/disable initial prompt (`true`/`false`).              |
| `GENERATE_TITLE`              | Enable/disable title generation for responses (`true`/`false`).|
| `REQUIRES_MENTION`            | Bot requires mention to respond (`true`/`false`).            |
| `SHOW_START_OF_CONVERSATION`  | Show start-of-conversation message (`true`/`false`).         |
| `SHOW_GENERATION_METRICS`     | Display generation metrics (`true`/`false`).                 |
| `KEEP_ALIVE`                  | Duration to keep the model loaded in memory after a request. |
| `RETRY_DELAY`                 | Delay in milliseconds between retries for API requests (ms). |
| `SERVER_UNAVAILABLE_DELAY`    | Delay in milliseconds before retrying when no servers are available.|
| `MAX_RETRIES`                 | Maximum number of retries for a failed API requests.         |

### Security and Best Practices
- **Protect Your Token**: The Discord bot token is akin to a password. Never share it or commit it to public repositories.
- **Enable Developer Mode in Discord**: To copy channel IDs for the `CHANNELS` variable, enable Developer Mode in Discord under User Settings > Advanced.
- **Use Secure Connections**: When connecting to Ollama or any external service, ensure your connections are secure.
