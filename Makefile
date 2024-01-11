# As long as you have Make running on your machine you should be able to use this file.
# make <command-name> runs a given command (e.g. make compose-up)
# Command-names are given by starting a line without a tab and followed by a colon (i.e.':').
# what the command runs is the line below the colon and that line must start with a tab of size 4.
# Running make without a command after it will run the first command in the file.

# starts the discord-ai-bot
compose-up:
	$(MAKE) setup_env && docker compose -p discord-ai up

# Stops docker compose without removing the containers from the system.
compose-stop:
	docker compose  -p discord-ai stop

# Stops docker compose and removes the containers from the system
compose-down:
	docker compose  -p discord-ai down

#  Run the local node project with make and without docker
local:
	$(MAKE) setup_env && npm i && node ./src/index.js

# This copies the .env.example (source) file to the .env (destination) file location
# The -n or no clobber means it will not overwrite the .env file if it already exists.
# The || : basically ignores the error code of the previous command and always succeeds.
setup_env:
	cp -n ./.env.example ./.env 2>/dev/null || :
