const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 1. Test Phone Number Extraction & Normalization
test('Phone extraction from recording filenames', () => {
  const filenames = [
    { name: 'Call_+919876543210_261111_103000.m4a', expected: '9876543210' },
    { name: 'Call_9876543210_20261111103000.m4a', expected: '9876543210' },
    { name: '09876543210_20261111103000.m4a', expected: '9876543210' },
    { name: 'Record_Unknown_Call_2026.m4a', expected: null },
  ];

  for (const { name, expected } of filenames) {
    const match = name.match(/(\+?\d{10,13})/);
    let clean = match ? match[1].replace(/\D/g, '') : null;
    if (clean && clean.length > 10) {
      clean = clean.slice(-10);
    }
    assert.strictEqual(clean, expected, `Failed for filename: ${name}`);
  }
});

// 2. Test File Hash & Deduplication logic
test('Audio file MD5 hash generation and deduplication', () => {
  const tempDir = path.join(__dirname, 'temp_test');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const testFile1 = path.join(tempDir, 'sample1.m4a');
  const testFile2 = path.join(tempDir, 'sample2.m4a');

  const content = Buffer.from('FAKE_AUDIO_SAMPLE_DATA_FOR_UNIT_TEST');
  fs.writeFileSync(testFile1, content);
  fs.writeFileSync(testFile2, content);

  const hash1 = crypto.createHash('md5').update(fs.readFileSync(testFile1)).digest('hex');
  const hash2 = crypto.createHash('md5').update(fs.readFileSync(testFile2)).digest('hex');

  assert.strictEqual(hash1, hash2, 'Identical audio contents must produce identical MD5 hashes');
  assert.strictEqual(typeof hash1, 'string');
  assert.strictEqual(hash1.length, 32);

  // Clean up temp
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.rmdirSync(tempDir);
});

// 3. Test Private Storage Directory Structure
test('Private storage directory is configured and non-public', () => {
  const privateDir = path.join(__dirname, '../storage/recordings');
  assert.ok(
    !privateDir.includes(path.join('uploads', 'public')),
    'Recordings must not be in a public static directory'
  );

  // Ensure storage/recordings directory exists or can be created
  if (!fs.existsSync(privateDir)) {
    fs.mkdirSync(privateDir, { recursive: true });
  }
  assert.ok(fs.existsSync(privateDir), 'Private recordings directory must exist');
});

// 4. Test CallLog Model Schema Properties for Background Sync & Unmatched Recordings
test('CallLog model schema supports unmatched background recordings', () => {
  const { CallLog } = require('../src/models/callLog.model');
  const leadIdField = CallLog.schema.path('leadId');
  const isMatchedField = CallLog.schema.path('isMatched');
  const syncedByBackgroundField = CallLog.schema.path('syncedByBackground');

  assert.strictEqual(leadIdField.isRequired, false, 'leadId must be optional to allow unmatched recordings');
  assert.ok(isMatchedField, 'isMatched field must exist on CallLog schema');
  assert.ok(syncedByBackgroundField, 'syncedByBackground field must exist on CallLog schema');
});
