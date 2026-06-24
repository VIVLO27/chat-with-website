import fs from 'fs';
import path from 'path';
import { retrieveContext } from '../lib/rag';

interface EvalQuestion {
  question: string;
  expectedSourceContains: string;
}

async function runEval() {
  const dataDir = path.join(process.cwd(), 'data', 'sessions');
  if (!fs.existsSync(dataDir)) {
    console.error('No sessions found. Run the dev server and crawl a site first.');
    process.exit(1);
  }

  const sessions = fs.readdirSync(dataDir);
  if (sessions.length === 0) {
    console.error('No sessions found. Run the dev server and crawl a site first.');
    process.exit(1);
  }

  // Use the most recent session
  const sessionId = sessions.sort((a, b) => {
    return fs.statSync(path.join(dataDir, b)).mtimeMs - fs.statSync(path.join(dataDir, a)).mtimeMs;
  })[0];

  console.log(`Using latest session ID: ${sessionId}`);

  const evalFile = path.join(process.cwd(), 'eval', 'questions.example.json');
  if (!fs.existsSync(evalFile)) {
    console.error('Eval file not found: eval/questions.example.json');
    process.exit(1);
  }

  const questions: EvalQuestion[] = JSON.parse(fs.readFileSync(evalFile, 'utf-8'));
  let passed = 0;

  console.log('--- Running Retrieval Eval ---');

  for (let i = 0; i < questions.length; i++) {
    const { question, expectedSourceContains } = questions[i];
    console.log(`\nQ${i + 1}: ${question}`);
    console.log(`Expected source to contain: "${expectedSourceContains}"`);

    const { sources, lowConfidence } = await retrieveContext(sessionId, question);

    if (sources.length === 0) {
      console.log('Result: ❌ FAILED (No sources retrieved)');
      continue;
    }

    const match = sources.some(s => s.url.includes(expectedSourceContains));
    if (match) {
      console.log('Result: ✅ PASSED');
      passed++;
    } else {
      console.log('Result: ❌ FAILED');
      console.log(`Retrieved sources:`);
      sources.forEach(s => console.log(`  - ${s.url}`));
    }
    if (lowConfidence) {
      console.log('(Note: Low confidence flag was set)');
    }
  }

  console.log(`\n--- Eval Complete: ${passed}/${questions.length} Passed ---`);
}

runEval().catch(console.error);
