/* eslint-disable */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCRATCH_DIR = path.join(__dirname, 'test_files');

const FILES_TO_TEST = [
  'test.pdf',
  'test.jpg',
  'test.png',
  'test.gif',
  'test.mp4',
  'test.mp3',
  'test.zip',
  'test.docx',
  'test.xlsx',
  'test.txt',
  'test.exe'
];

function getFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

async function runTest() {
  console.log('Starting automated P2P transfer integrity checks...');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  
  const senderPage = await context.newPage();
  senderPage.on('console', msg => console.log(`SENDER: ${msg.text()}`));
  const receiverPage = await context.newPage();
  receiverPage.on('console', msg => console.log(`RECEIVER: ${msg.text()}`));
  
  console.log('Opening P2P Sender app on localhost:3000...');
  await senderPage.goto('http://localhost:3000');
  
  console.log('Creating room...');
  await senderPage.locator('text=Create Room').dispatchEvent('click');
  
  await senderPage.waitForSelector('text=Room Created. Share this code with peer:');
  const pageText = await senderPage.innerText('main');
  const codeMatch = pageText.match(/[A-Z0-9]{6}/);
  if (!codeMatch) {
    throw new Error('Failed to extract room code from UI');
  }
  const roomCode = codeMatch[0];
  console.log(`Room code generated: ${roomCode}`);
  
  console.log('Receiver joining the room...');
  await receiverPage.goto(`http://localhost:3000/?room=${roomCode}`);
  
  console.log('Waiting for P2P connection to establish...');
  await senderPage.waitForSelector('text=Connected P2P', { timeout: 15000 });
  await receiverPage.waitForSelector('text=Connected P2P', { timeout: 15000 });
  console.log('WebRTC P2P DataChannel connection established successfully!');
  
  let passedCount = 0;
  
  for (const filename of FILES_TO_TEST) {
    console.log(`\n----------------------------------------`);
    console.log(`Testing transfer for: ${filename}`);
    
    const originalPath = path.join(SCRATCH_DIR, filename);
    if (!fs.existsSync(originalPath)) {
      console.error(`Error: Original file not found at ${originalPath}`);
      continue;
    }
    
    const originalSize = fs.statSync(originalPath).size;
    const originalHash = getFileHash(originalPath);
    console.log(`Original Size: ${originalSize} bytes`);
    
    // Upload file on sender page
    console.log(`Uploading ${filename} on sender side...`);
    const fileInput = await senderPage.locator('input[type="file"]');
    await fileInput.setInputFiles(originalPath);
    
    // Wait for receiver page to display the incoming offer card
    console.log('Waiting for incoming file offer on receiver side...');
    try {
      await receiverPage.waitForSelector('text=Incoming File Offer', { timeout: 8000 });
    } catch (e) {
      console.error('TIMEOUT WAITING FOR FILE OFFER. SENDER PAGE STATE:');
      console.log(await senderPage.innerText('main'));
      console.error('RECEIVER PAGE STATE:');
      console.log(await receiverPage.innerText('main'));
      throw e;
    }
    
    // Accept the file on receiver page
    console.log('Accepting and streaming chunks...');
    await receiverPage.locator('text=Accept').first().dispatchEvent('click');
    
    // Wait for the transfer to complete (progress reaches 100% and Download File button appears)
    console.log('Waiting for transfer to complete...');
    await receiverPage.waitForSelector('text=Download', { timeout: 20000 });
    
    // Download the completed file
    console.log('Downloading file...');
    const [ download ] = await Promise.all([
      receiverPage.waitForEvent('download'),
      receiverPage.locator('text=Download').first().dispatchEvent('click')
    ]);
    
    const downloadedPath = path.join(SCRATCH_DIR, 'downloaded_' + filename);
    await download.saveAs(downloadedPath);
    
    // Verify file properties
    const downloadedSize = fs.statSync(downloadedPath).size;
    const downloadedHash = getFileHash(downloadedPath);
    console.log(`Downloaded Size: ${downloadedSize} bytes`);
    
    // Compare
    const sizeMatch = originalSize === downloadedSize;
    const hashMatch = originalHash === downloadedHash;
    const filenameMatch = download.suggestedFilename() === filename;
    
    if (sizeMatch && hashMatch && filenameMatch) {
      console.log(`✅ SUCCESS: ${filename} transferred correctly!`);
      passedCount++;
    } else {
      console.error(`❌ FAILURE: ${filename} transfer verification failed!`);
      if (!filenameMatch) console.error(`   - Filename Mismatch: expected ${filename}, got ${download.suggestedFilename()}`);
      if (!sizeMatch) console.error(`   - Size Mismatch: expected ${originalSize}, got ${downloadedSize}`);
      if (!hashMatch) console.error(`   - Checksum Mismatch: expected ${originalHash}, got ${downloadedHash}`);
    }
    
    try {
      fs.unlinkSync(downloadedPath);
    } catch (e) {}
    
    console.log('Resetting transfer state...');
    await receiverPage.locator('text=Another').first().dispatchEvent('click');
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log(`\n========================================`);
  console.log(`Test Completed. Passed: ${passedCount}/${FILES_TO_TEST.length}`);
  
  await browser.close();
  process.exit(passedCount === FILES_TO_TEST.length ? 0 : 1);
}

runTest().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
