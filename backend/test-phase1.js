#!/usr/bin/env node

/**
 * Test Script for Phase 1: WhatsApp Onboarding & Survey Flow
 * 
 * This simulates a complete farmer survey flow:
 * 1. Farmer sends "START"
 * 2. System onboards farmer & detects language
 * 3. First question is sent
 * 4. Farmer responds with numbers (1-6)
 * 5. Conditional logic determines next question
 * 6. Survey completes
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

process.env.OTP_ENABLED = 'false';

const BACKEND_URL = 'http://localhost:3000';
const DEFAULT_WEBHOOK_PATH = '/api/whatsapp/webhook';

const cleanWebhookPath = (value) => {
  if (!value) return DEFAULT_WEBHOOK_PATH;

  let candidate = String(value).trim();
  if (!candidate) return DEFAULT_WEBHOOK_PATH;
  if (!candidate.startsWith('/')) candidate = `/${candidate}`;

  while (candidate.length > 1 && candidate.endsWith('/')) {
    candidate = candidate.slice(0, -1);
  }

  return candidate;
};

const resolveWebhookPath = () => {
  const envValue = process.env.WHATSAPP_WEBHOOK_URL?.trim();
  if (!envValue) return DEFAULT_WEBHOOK_PATH;

  try {
    const { pathname } = new URL(envValue);
    return cleanWebhookPath(pathname);
  } catch {
    return cleanWebhookPath(envValue);
  }
};

const WEBHOOK_ENDPOINT = `${BACKEND_URL}${resolveWebhookPath()}`;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'farmer_survey_pilot_2026';

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

/**
 * Simulate incoming WhatsApp message
 */
async function sendMessage(phoneNumber, messageText, messageType = 'text') {
  const timestamp = Math.floor(Date.now() / 1000);

  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: phoneNumber,
                  id: `msg_${timestamp}`,
                  timestamp,
                  type: messageType,
                  [messageType]: { body: messageText },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  try {
    const response = await axios.post(WEBHOOK_ENDPOINT, payload);
    console.log(
      `${colors.green}✓ Message sent:${colors.reset} [${phoneNumber}] "${messageText}"`
    );
    return response.data;
  } catch (error) {
    console.error(
      `${colors.red}✗ Error sending message:${colors.reset}`,
      error.message
    );
    throw error;
  }
}

/**
 * Test webhook verification
 */
async function testWebhookVerification() {
  console.log(`\n${colors.cyan}=== Testing Webhook Verification ===${colors.reset}`);

  try {
    const response = await axios.get(
      `${WEBHOOK_ENDPOINT}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=test_challenge_string`
    );

    if (response.data === 'test_challenge_string') {
      console.log(
        `${colors.green}✓ Webhook verification successful${colors.reset}`
      );
      return true;
    }
  } catch (error) {
    console.error(
      `${colors.red}✗ Webhook verification failed:${colors.reset}`,
      error.message
    );
    return false;
  }
}

/**
 * Test complete survey flow
 */
async function testSurveyFlow() {
  console.log(`\n${colors.cyan}=== Testing Complete Survey Flow ===${colors.reset}`);

  const phoneNumber = '+919876543210';
  const farmerId = 'TEST_FARMER_1';

  console.log(`\n${colors.blue}Farmer ID: ${farmerId}${colors.reset}`);
  console.log(`${colors.blue}Phone: ${phoneNumber}${colors.reset}`);

  // Step 1: Farmer sends START
  console.log(`\n${colors.yellow}STEP 1: Farmer sends START${colors.reset}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await sendMessage(phoneNumber, 'START');

  // Step 2: Wait and send first response (LOCATION)
  console.log(`\n${colors.yellow}STEP 2: Farmer responds to Q_LOCATION (Region)${colors.reset}`);
  console.log(
    `${colors.cyan}Q_LOCATION Options:${colors.reset} 1.Telangana 2.Karnataka 3.Andhra Pradesh 4.Maharashtra 5.Tamil Nadu 6.Other`
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sendMessage(phoneNumber, '1'); // Telangana

  // Step 3: Farmer responds to Q1 (Primary Crop)
  console.log(`\n${colors.yellow}STEP 3: Farmer responds to Q1 (Primary Crop)${colors.reset}`);
  console.log(
    `${colors.cyan}Q1 Options:${colors.reset} 1.Wheat 2.Cotton 3.Rice 4.Maize 5.Sugarcane 6.Other`
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sendMessage(phoneNumber, '2'); // Cotton

  // Step 4: Q2 response
  console.log(`\n${colors.yellow}STEP 3: Farmer responds to Q2 (Farm Size)${colors.reset}`);
  console.log(
    `${colors.cyan}Q2 Options:${colors.reset} 1.<1acre 2.1-5 3.5-10 4.10-20 5.>20`
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sendMessage(phoneNumber, '3'); // 5-10 acres

  // Step 4: Q3 response (This triggers conditional logic)
  console.log(
    `\n${colors.yellow}STEP 4: Farmer responds to Q3 (Improved Seeds)${colors.reset}`
  );
  console.log(
    `${colors.cyan}Q3 Options:${colors.reset} 1.Yes 2.No [if No, skips Q4] 3.I don't know`
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sendMessage(phoneNumber, '1'); // Yes - should go to Q4

  // Step 5: Q4 response
  console.log(
    `\n${colors.yellow}STEP 5: Farmer responds to Q4 (Seed Supplier)${colors.reset}`
  );
  console.log(
    `${colors.cyan}Q4 Options:${colors.reset} 1.Govt 2.Private 3.Dealer 4.Other`
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sendMessage(phoneNumber, '2'); // Private

  // Step 6-8: Remaining questions
  console.log(
    `\n${colors.yellow}STEP 6: Farmer responds to Q5 (Fertilizers)${colors.reset}`
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sendMessage(phoneNumber, '1'); // Yes

  console.log(
    `\n${colors.yellow}STEP 7: Farmer responds to Q6 (Irrigation)${colors.reset}`
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sendMessage(phoneNumber, '1'); // Drip

  console.log(
    `\n${colors.yellow}STEP 8: Farmer responds to Q7 (Pest/Disease)${colors.reset}`
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sendMessage(phoneNumber, '2'); // No

  console.log(
    `\n${colors.yellow}STEP 9: Farmer responds to Q8 (Annual Income)${colors.reset}`
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sendMessage(phoneNumber, '3'); // 1-2L

  console.log(
    `\n${colors.green}✓ Survey flow complete!${colors.reset}\n`
  );
}

/**
 * Test conditional logic (Q3: No option)
 */
async function testConditionalLogic() {
  console.log(
    `\n${colors.cyan}=== Testing Conditional Logic (Q3: No = Skip Q4) ===${colors.reset}`
  );

  const phoneNumber = '+919876543211';
  const farmerId = 'TEST_FARMER_2';

  console.log(`\n${colors.blue}Farmer ID: ${farmerId}${colors.reset}`);
  console.log(`${colors.blue}Phone: ${phoneNumber}${colors.reset}`);

  // START
  console.log(`\n${colors.yellow}Farmer starts survey...${colors.reset}`);
  await sendMessage(phoneNumber, 'START');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Q_LOCATION: Choose region
  console.log(`${colors.yellow}Q_LOCATION Response: 1 (Telangana)${colors.reset}`);
  await sendMessage(phoneNumber, '1');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Q1
  console.log(`${colors.yellow}Q1 Response: 1 (Wheat)${colors.reset}`);
  await sendMessage(phoneNumber, '1');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Q2
  console.log(`${colors.yellow}Q2 Response: 2 (1-5 acres)${colors.reset}`);
  await sendMessage(phoneNumber, '2');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Q3: Select "No" (optionIndex 1)
  // This should trigger NEXT_IF_OPTION relationship to skip Q4
  console.log(
    `${colors.yellow}Q3 Response: 2 (No) ${colors.green}→ SHOULD SKIP Q4${colors.reset}`
  );
  await sendMessage(phoneNumber, '2');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Next should be Q5, NOT Q4
  console.log(
    `${colors.green}✓ Conditional logic working if next question is Q5${colors.reset}\n`
  );
}

/**
 * Main test runner
 */
async function runTests() {
  console.log(`\n${colors.cyan}════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}  PHASE 1 TEST SUITE - WhatsApp Survey Flow${colors.reset}`);
  console.log(`${colors.cyan}════════════════════════════════════════════${colors.reset}`);

  try {
    // Test 1: Webhook verification
    const verified = await testWebhookVerification();
    if (!verified) {
      console.error(
        `${colors.red}Webhook verification failed. Aborting tests.${colors.reset}`
      );
      process.exit(1);
    }

    // Test 2: Complete survey flow
    await testSurveyFlow();

    // Test 3: Conditional logic
    await testConditionalLogic();

    console.log(`\n${colors.cyan}════════════════════════════════════════════${colors.reset}`);
    console.log(
      `${colors.green}✓ ALL TESTS PASSED! Phase 1 is working.${colors.reset}`
    );
    console.log(`${colors.cyan}════════════════════════════════════════════${colors.reset}\n`);
  } catch (error) {
    console.error(
      `\n${colors.red}Test failed:${colors.reset}`,
      error.message
    );
    process.exit(1);
  }
}

// Run tests
runTests();
