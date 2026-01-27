import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseTranscript(inputFile) {
  // Set up path to data/raw directory
  const projectRoot = join(__dirname, '..');
  const rawDir = join(projectRoot, 'data', 'raw');
  const filePath = join(rawDir, inputFile);

  // Read the file
  const rawText = readFileSync(filePath, 'utf-8');
  const splitText = rawText.split('\n');

  // Extract the Title (example: DISCO + QA Wolf - AI Testing Partnership)
  const titleText = splitText[0].trim().split(`"`)[1];

  // Extract the Date (example: Recorded on Jan 20, 2026 via Zoom, 1h 1m)
  const recordedText = splitText.find((line) => line.includes('Recorded on'));

  // Get Date
  const dateArray = recordedText.match(/Recorded on (\w+ \d+, \d{4})/);
  const date = dateArray[1];

  // Get Duration - handle both "1h 1m" and "22m" formats
  let duration = null;
  const durationWithHours = recordedText.match(/(\d+)h\s*(\d+)m/);
  const durationMinutesOnly = recordedText.match(/(\d+)m/);

  if (durationWithHours) {
    // Format: "1h 1m" or "1h1m"
    duration = durationWithHours[1] + 'h ' + durationWithHours[2] + 'm';
  } else if (durationMinutesOnly) {
    // Format: "22m" (minutes only)
    duration = durationMinutesOnly[1] + 'm';
  }

  // Find index "participants" is in the text
  const participantsIndex = splitText.indexOf('Participants');

  // Find index "transcript" is in the text
  const transcriptIndex = splitText.indexOf('Transcript');

  // Extract the participants
  let participantsText = splitText.slice(participantsIndex + 1, transcriptIndex);
  participantsText = participantsText.filter((line) => line.trim() !== '');

  // Extract the participants
  const participants = [];
  let currentCompany = '';
  participantsText.forEach((line) => {
    if (!line.includes(',')) {
      currentCompany = line.trim();
    } else {
      const [name, role] = line.split(',');
      participants.push({
        name: name.trim(),
        role: role.trim(),
        company: currentCompany,
      });
    }
  });

  // Extract the Transcript
  let transcriptText = splitText.slice(transcriptIndex + 1);
  transcriptText = transcriptText.filter((line) => line.trim() !== '');

  // Extract the Transcript
  const transcript = [];
  let currentTurn = null;

  transcriptText.forEach((line) => {
    // Check if this line is a timestamp line (format: "0:00 | Stephen")
    const timestampMatch = line.match(/^(\d+:\d+)\s*\|\s*(.+)$/);

    if (timestampMatch) {
      // Save previous turn if it exists
      if (currentTurn) {
        transcript.push(currentTurn);
      }

      // Start a new turn
      currentTurn = {
        timestamp: timestampMatch[1].trim(),
        speaker: timestampMatch[2].trim(),
        text: '',
      };
    } else if (currentTurn) {
      // This is text continuing the current turn
      // Add space if there's already text, then append the line
      if (currentTurn.text) {
        currentTurn.text += ' ';
      }
      currentTurn.text += line.trim();
    }
  });

  // Don't forget the last turn
  if (currentTurn) {
    transcript.push(currentTurn);
  }

  // Combine everything into structured object
  const parsedData = {
    metadata: {
      title: titleText,
      date: date,
      duration: duration,
      sourceFile: inputFile,
    },
    participants: participants,
    transcript: transcript,
  };

  // Save to JSON file
  const processedDir = join(projectRoot, 'data', 'processed');
  mkdirSync(processedDir, { recursive: true });

  const outputFile = join(processedDir, basename(inputFile, extname(inputFile)) + '.json');

  writeFileSync(outputFile, JSON.stringify(parsedData, null, 2), 'utf-8');

  return parsedData;
}

// Command line usage
const inputFile = process.argv[2];

if (inputFile) {
  parseTranscript(inputFile);
} else {
  console.error('Usage: node parse_transcripts.js <filename>');
  console.error('Example: node parse_transcripts.js 2026-01-20_disco_demo.txt');
  process.exit(1);
}

export { parseTranscript };
