import { GoogleGenAI } from '@google/genai';

async function testModels() {
  const apiKey = process.env.GEMINI_API_KEY || '';
  
  const ai = new GoogleGenAI({ apiKey });
  
  const candidates = [
    'gemini-3.1-flash-lite'
  ];

  console.log('Testing models to find a working Chat model...');
  
  let workingModel = null;
  for (const model of candidates) {
    try {
      console.log(`\nTesting ${model}...`);
      const response = await ai.models.generateContent({
        model,
        contents: 'Say hello',
      });
      console.log(`✅ SUCCESS! ${model} responded: ${response.text}`);
      workingModel = model;
      break;
    } catch (e: any) {
      console.log(`❌ FAILED: ${e.message}`);
    }
  }

  if (workingModel) {
    console.log(`\n🎉 The winner is: ${workingModel}. Use this in .env.local!`);
  } else {
    console.log(`\n😭 All candidates failed. The free tier API is completely tapped out.`);
  }
}

testModels();
