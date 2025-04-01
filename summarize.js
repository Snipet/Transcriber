const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const fs = require('fs');
dotenv.config(); // Load environment variables from .env file



async function summarize(transcript, prompt) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-pro-exp-03-25",
        systemInstruction: prompt,
    });

    const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 65536,
        responseModalities: [
        ],
        responseMimeType: "text/plain",
    };

    const chatSession = model.startChat({
        generationConfig,
        history: [
        ],
    })
    // Send the transcript as a message to the Gemini model
    const result = await chatSession.sendMessage(transcript);
    return result;

}

module.exports = { summarize };
