import { SlashCommandBuilder } from "discord.js";

const text2img = new SlashCommandBuilder()
	.setName("text2img")
	.setDescription("Convert text to image")
	.addStringOption((option) =>
		option.setName("prompt").setDescription("Text to convert").setRequired(true)
	)
	.addNumberOption((option) =>
		option
			.setName("width")
			.setDescription("Width of the image")
			.setRequired(false)
			.setMinValue(128)
			.setMaxValue(1024)
	)
	.addNumberOption((option) =>
		option
			.setName("height")
			.setDescription("Height of the image")
			.setRequired(false)
			.setMinValue(128)
			.setMaxValue(1024)
	)
	.addNumberOption((option) =>
		option
			.setName("steps")
			.setDescription("Number of steps")
			.setRequired(false)
			.setMinValue(5)
			.setMaxValue(20)
	)
	.addNumberOption((option) =>
		option
			.setName("batch_count")
			.setDescription("Batch count")
			.setRequired(false)
			.setMinValue(1)
			.setMaxValue(4)
	)
	.addNumberOption((option) =>
		option
			.setName("batch_size")
			.setDescription("Batch size")
			.setRequired(false)
			.setMinValue(1)
			.setMaxValue(5)
	)
	.addBooleanOption((option) =>
		option
			.setName("enhance_prompt")
			.setDescription("Enhance prompt")
			.setRequired(false)
	);

export default text2img;
