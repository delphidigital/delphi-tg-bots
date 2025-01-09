import fs from 'fs';
import OpenAI from "openai";
import { Readable } from 'stream';
import { finished } from 'stream/promises';

export const AUDIO_FILE_DIRECTORY = 'audio_files';

/**
 * Fetches the path of a voice file located on TG servfer
 * @param fileId The ID of the file to fetch.
 * @returns The voice file path.
 */
export async function getTgFilePathFromFileId(fileId: string) {
  const filePathResponse = await fetch(`https://api.telegram.org/bot${process.env.DELPHI_READS_BOT_TOKEN}/getFile?file_id=${fileId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });
  const filePathJson = await filePathResponse.json();
  return filePathJson.result.file_path;
}

/**
 * Fetches a voice file from TG server
 * @param filePath The path to the file on TG server.
 * @param filename The name of local file to save w/o file extension
 */
export async function downloadVoiceFileFromTg(filePath: string, filename: string) {
  const stream = fs.createWriteStream(`${AUDIO_FILE_DIRECTORY}/${filename}.oga`);
  const { body } = await fetch(`https://api.telegram.org/file/bot${process.env.DELPHI_READS_BOT_TOKEN}/${filePath}`);
  await finished(Readable.fromWeb(body).pipe(stream));
}

/**
 * Transcribe an audio file to text
 * @param filePath Path of local file to transcribe.
 * @returns The transcription text.
 */
export async function transcribeAudio(filePath: string, openaiClient: OpenAI): Promise<string> {
  const transcription = await openaiClient.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "whisper-1",
  });
  fs.unlinkSync(filePath);
  return transcription.text;
}
