#!/usr/bin/env node
import dotenv from 'dotenv';
import { closeMongo, initializeMongo } from '../src/config/mongoConfig.js';
import {
  AnswerModel,
  FarmerModel,
  QuestionModel,
  RegionModel,
  SurveySessionModel,
} from '../src/models/index.js';
import { initializeSurveySchema, validateQuestionnaire, SAMPLE_QUESTIONNAIRE } from '../src/services/surveyEngine.js';

dotenv.config();

const REGION_METADATA = {
  telangana: {
    language: 'telugu',
    area: 'Hyderabad',
  },
  karnataka: {
    language: 'kannada',
    area: 'Bengaluru',
  },
  andhra_pradesh: {
    language: 'telugu',
    area: 'Visakhapatnam',
  },
};

const SAMPLE_FARMERS = [
  {
    phoneNumber: '+919876543210',
    sessionId: 'seed_session_1',
    region: 'telangana',
    language: 'telugu',
    status: 'completed',
    sessionStatus: 'completed',
    answers: [
      { questionId: 'Q1', optionIndex: 1 },
      { questionId: 'Q2', optionIndex: 3 },
      { questionId: 'Q3', optionIndex: 0 },
      { questionId: 'Q4', optionIndex: 1 },
      { questionId: 'Q5', optionIndex: 0 },
      { questionId: 'Q6', optionIndex: 0 },
      { questionId: 'Q7', optionIndex: 1 },
      { questionId: 'Q8', optionIndex: 3 },
    ],
  },
  {
    phoneNumber: '+919876543211',
    sessionId: 'seed_session_2',
    region: 'karnataka',
    language: 'kannada',
    status: 'in_progress',
    sessionStatus: 'in_progress',
    answers: [
      { questionId: 'Q1', optionIndex: 0 },
      { questionId: 'Q2', optionIndex: 2 },
    ],
  },
  {
    phoneNumber: '+919876543212',
    sessionId: 'seed_session_3',
    region: 'andhra_pradesh',
    language: 'telugu',
    status: 'in_progress',
    sessionStatus: 'in_progress',
    answers: [],
  },
];

const seedFarmer = async (db, farmer, questionMap) => {
  const regionInfo = REGION_METADATA[farmer.region] ?? {
    language: farmer.language,
    area: 'Unknown area',
  };

  await RegionModel.updateOne(
    { region: farmer.region },
    {
      $set: {
        region: farmer.region,
        language: regionInfo.language,
        area: regionInfo.area,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await FarmerModel.updateOne(
    { phoneNumber: farmer.phoneNumber },
    {
      $set: {
        preferredLanguage: farmer.language,
        region: farmer.region,
        status: farmer.status,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await SurveySessionModel.updateOne(
    { id: farmer.sessionId },
    {
      $set: {
        phoneNumber: farmer.phoneNumber,
        status: farmer.sessionStatus,
        completedAt: farmer.sessionStatus === 'completed' ? new Date() : null,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await AnswerModel.deleteMany({ sessionId: farmer.sessionId });

  if (!farmer.answers || farmer.answers.length === 0) {
    console.log(`ℹ️  No answers to seed for ${farmer.phoneNumber}`);
    return;
  }

  const answerDocs = farmer.answers.map((answer) => {
    const normalizedOptionIndex = Number.isFinite(answer.optionIndex)
      ? Math.trunc(answer.optionIndex)
      : 0;
    const question = questionMap.get(answer.questionId);
    const selectedOption = question?.options?.[normalizedOptionIndex] ?? null;

    return {
      id: `seed_${farmer.phoneNumber.replace(/\+/g, '')}_${answer.questionId}`,
      phoneNumber: farmer.phoneNumber,
      sessionId: farmer.sessionId,
      questionId: answer.questionId,
      selectedOptionIndex: normalizedOptionIndex,
      selectedOption,
      responseMode: 'text',
      confidence: 1.0,
      createdAt: new Date(),
    };
  });

  await AnswerModel.insertMany(answerDocs, { ordered: false });
};

const clearSeedData = async (db) => {
  console.log('🧹 Cleaning existing survey data (Farmers, SurveySessions, Answers, Regions)...');
  await Promise.all([
    FarmerModel.deleteMany({}),
    SurveySessionModel.deleteMany({}),
    AnswerModel.deleteMany({}),
    RegionModel.deleteMany({}),
  ]);
  console.log('🧼 Cleanup complete.');
};

const seedDatabase = async () => {
  console.log('🌱 Seeding sample MongoDB data...');
  const { db } = await initializeMongo();

  try {
    // validate in-repo SAMPLE_QUESTIONNAIRE before writing to DB
    const val = validateQuestionnaire(SAMPLE_QUESTIONNAIRE);
    if (!val.ok) {
      console.error('❌ SAMPLE_QUESTIONNAIRE validation failed:');
      for (const it of val.issues) console.error(' -', it);
      throw new Error('SAMPLE_QUESTIONNAIRE contains errors; fix the definitions before seeding.');
    }

    await initializeSurveySchema(db);
    await clearSeedData(db);

    const questions = await QuestionModel.find({}).lean();
    const questionMap = new Map(questions.map((q) => [q.id, q]));

    for (const farmer of SAMPLE_FARMERS) {
      console.log(`🔹 Seeding farmer ${farmer.phoneNumber}`);
      await seedFarmer(db, farmer, questionMap);
    }

    console.log('✅ Seed data loaded successfully!');
  } finally {
    await closeMongo();
  }
};

seedDatabase().catch((error) => {
  console.error('❌ Seed script failed:', error.message);
  process.exitCode = 1;
});
