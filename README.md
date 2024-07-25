<div align="center">
    <h1><a href="#"></a>Discord AI Bot</h1>
    <h3 align="center"><a href="#"></a>Discord bot to interact with <a href="https://github.com/jmorganca/ollama">Ollama</a> and <a href="https://github.com/AUTOMATIC1111/stable-diffusion-webui">AUTOMATIC1111 Stable Diffusion</a> as a chatbot</h3>
    <h3><a href="#"></a><img alt="Stars" src="https://img.shields.io/github/stars/mekb-turtle/discord-ai-bot?display_name=tag&style=for-the-badge" /></h3>
    <h3><a href="#"></a><img alt="Discord chat with the bot" src="assets/screenshot.png" /></h3>
</div>

### New Maintainer
This repository is no longer being developed on by me, [mekb-turtle](https://github.com/mekb-turtle).

### Set-up instructions
1. Install [Node.js](https://nodejs.org) (if you have a package manager, use that instead to install this)
    - Make sure to install at least v14 of Node.js
2. Install [Ollama](https://github.com/jmorganca/ollama) (ditto)
3. Pull (download) a model, e.g `ollama pull orca` or `ollama pull llama2`
4. Start Ollama by running `ollama serve`
5. [Create a Discord bot](https://discord.com/developers/applications)
    - Under Application » Bot
        - Enable Message Content Intent
        - Enable Server Members Intent (for replacing user mentions with the username)
6. Invite the bot to a server
    1. Go to Application » OAuth2 » URL Generator
    2. Enable `bot`
    3. Enable Send Messages, Read Messages/View Channels, and Read Message History
    4. Under Generated URL, click Copy and paste the URL in your browser
7. Rename `.env.example` to `.env` and edit the `.env` file
    - You can get the token from Application » Bot » Token, **never share this with anyone**
    - Make sure to change the model if you aren't using `orca`
    - Ollama URL can be kept the same unless you have changed the port
    - You can use multiple Ollama servers at the same time by separating the URLs with commas
    - Set the channels to the channel ID, comma separated
        1. In Discord, go to User Settings » Advanced, and enable Developer Mode
        2. Right click on a channel you want to use, and click Copy Channel ID
    - You can edit the system message the bot uses, or disable it entirely
8. Install the required dependencies with `npm i`
0. Start the bot with `npm start`
10. You can interact with the bot by @mentioning it with your message
11. Install <a href="https://github.com/AUTOMATIC1111/stable-diffusion-webui">Stable Diffusion</a>
12. Run the script `./webui.sh --api --listen`

### Set-up instructions with Docker
1. Install [Docker](https://docs.docker.com/get-docker/)
   - Should be atleast compatible with version 3 of compose (docker engine 1.13.0+)
2. Repeat steps 2—7 from the other setup instructions
3. Start the bot with `make compose-up` if you have Make installed
   - Otherwise, try `docker compose -p discord-ai up` instead
4. You can interact with the bot by @mentioning it with your message
