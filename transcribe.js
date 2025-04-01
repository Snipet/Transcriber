const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { summarize } = require('./summarize');

const dotenv = require('dotenv');
dotenv.config();

ffmpeg.setFfmpegPath(ffmpegStatic);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });



async function main() {
  // Input validation
  let totalCost = 0;
  if (process.argv.length < 3) {
    console.error('Usage: node transcribe.js <input.mp4> [time_splits]');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY environment variable');
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('Missing GEMINI_API_KEY environment variable');
  }

  const inputPath = process.argv[2];
  const timeSplits = process.argv[3] ? process.argv[3].split(',').map(Number) : [];
  const outputDir = path.dirname(inputPath);
  const baseName = path.basename(inputPath, path.extname(inputPath));

  // Convert MP4 to MP3
  console.log(`Starting conversion of "${inputPath}" to MP3...`);
  const audioPath = path.join(outputDir, `${baseName}.mp3`);
  await convertToMp3(inputPath, audioPath);
  console.log(`Finished converting to MP3 at "${audioPath}".\n`);

  let totalSeconds = await getAudioDuration(audioPath);
  totalCost += totalSeconds / 60 * 0.006; // Calculate cost based on duration (assuming $0.006 per minute for OpenAI)

  console.log(`Audio duration: ${totalSeconds}`);

  // Process audio based on time splits
  let allSegments = [];
  
  if (timeSplits.length > 0) {
    console.log('Time splits detected. Splitting audio into chunks: ', timeSplits.join(', '));
    const duration = await getAudioDuration(audioPath);
    const chunks = await splitAudioIntoChunks(audioPath, timeSplits, duration, outputDir);
    console.log(`Finished splitting audio into ${chunks.length} chunk(s).\n`);

    // Transcribe each chunk in sequence
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`Transcribing chunk #${i + 1} (start: ${chunk.startTime}s)...`);
      try {
        const transcription = await transcribeAudio(chunk.path);
        const adjustedSegments = transcription.segments.map(segment => ({
          ...segment,
          start: segment.start + chunk.startTime,
          end: segment.end + chunk.startTime
        }));
        allSegments.push(...adjustedSegments);
      } finally {
        fs.unlinkSync(chunk.path); // Clean up chunk file
      }
      console.log(`Done transcribing chunk #${i + 1}.\n`);
    }
  } else {
    console.log('No time splits specified. Transcribing the entire audio file...');
    const transcription = await transcribeAudio(audioPath);
    allSegments = transcription.segments;
    console.log('Done transcribing entire file.\n');
  }

  // Generate final transcript
  console.log('Generating final transcript...');
  allSegments.sort((a, b) => a.start - b.start);
  const transcript = formatSegments(allSegments);
  const outputPath = path.join(outputDir, `${baseName}_transcript.txt`);
  fs.writeFileSync(outputPath, transcript);
  console.log(`Transcript saved to: ${outputPath}`);


  // Summarize the transcript
  console.log('Summarizing the transcript...');
  const response = await summarize(transcript);
  const sum = response.response.text();

  // Save the summary to a file
  summarizeOutputPath = path.join(outputDir, `${baseName}_summary.md`);
  fs.writeFileSync(summarizeOutputPath, sum);

  console.log(`Summary saved to: ${summarizeOutputPath}`);
  console.log(`Total cost for transcription: $${totalCost.toFixed(4)}`); // Display total cost based on duration
  console.log('Transcription and summarization complete.\n');
}

async function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputPath)
      .audioCodec('libmp3lame')
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function splitAudioIntoChunks(audioPath, timeSplits, duration, outputDir) {
  // Process time splits
  const processedSplits = timeSplits
    .map(t => Math.max(0, Math.min(t, duration)))
    .filter((t, i, arr) => arr.indexOf(t) === i) // Remove duplicates
    .sort((a, b) => a - b);

  // Create chunk intervals
  const startTimes = [0, ...processedSplits];
  const endTimes = [...processedSplits, duration];
  const chunks = [];

  for (let i = 0; i < startTimes.length; i++) {
    const start = startTimes[i];
    const end = endTimes[i];
    if (start >= end) continue;

    const chunkPath = path.join(outputDir, `${path.basename(audioPath, '.mp3')}_chunk${i}.mp3`);
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(audioPath)
        .seekInput(start)
        .duration(end - start)
        .output(chunkPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    chunks.push({ path: chunkPath, startTime: start });
  }
  return chunks;
}

async function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      err ? reject(err) : resolve(metadata.format.duration);
    });
  });
}

async function transcribeAudio(audioPath) {
  // Calls Whisper API
  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    response_format: 'verbose_json',
  });
  return response;
}

function formatSegments(segments) {
  return segments.map(segment => 
    `[${formatTime(segment.start)} --> ${formatTime(segment.end)}] ${segment.text}`
  ).join('\n');
}

function formatTime(seconds) {
  const date = new Date(seconds * 1000);
  return date.toISOString().substr(11, 12).replace('.', ',');
}

main().catch(console.error);
