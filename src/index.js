import { ShardingManager, Events } from "discord.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, LogLevel } from "meklog";
import dotenv from "dotenv";

dotenv.config();

const production = process.env.NODE_ENV == "prod" || process.env.NODE_ENV == "production";
const log = new Logger(production, "Shard Manager");

log(LogLevel.Info, "Loading");

const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "bot.js");
const manager = new ShardingManager(filePath, { token: process.env.TOKEN });

manager.on("shardCreate", async shard => {
	const shardLog = new Logger(production, `Shard #${shard.id}`);

	shardLog(LogLevel.Info, "Created shard");
	
	shard.on('error', error => {
        shardLog(LogLevel.Error, `Shard Error: ${error.message}`);
    });
	
	shard.on(Events.ShardDisconnect, (event, id) => {
    shardLog(LogLevel.Warn, `Shard #${id} disconnected: ${event.code} (${event.reason || "No reason provided"})`);
	});
	
	shard.on(Events.ShardReconnecting, id => {
    shardLog(LogLevel.Info, `Shard #${id} is reconnecting...`);
	});
	
	shard.on(Events.ShardResume, (id, replayedEvents) => {
    shardLog(LogLevel.Info, `Shard #${id} resumed, replaying ${replayedEvents} events.`);
	});

	shard.once(Events.ClientReady, async () => {
		shard.send({ shardID: shard.id, logger: shardLog.data })
			.then(() => shardLog(LogLevel.Info, "Shard ready"))
			.catch(error => shardLog(LogLevel.Error, `Error sending data to shard: ${error}`));
	});
});

const spawnOptions = {
    amount: process.env.SHARD_AMOUNT || 'auto',
    delay: parseInt(process.env.SHARD_SPAWN_DELAY, 10) || 5500
};

manager.spawn(spawnOptions).catch(error => {
    log(LogLevel.Error, `Error spawning shards: ${error}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    log(LogLevel.Info, "Shutting down gracefully...");
    manager.shards.forEach(shard => shard.kill());
});