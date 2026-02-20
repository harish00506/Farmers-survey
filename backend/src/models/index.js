import mongoose from 'mongoose';

const { Schema } = mongoose;

const baseOptions = {
  strict: false,
  versionKey: false,
};

const userSchema = new Schema({
  email: { type: String, required: true, index: true },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'user' },
  surveyName: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date },
}, { ...baseOptions, collection: 'users' });

userSchema.index({ email: 1 }, { unique: true, name: 'users_email_unique' });

const surveySchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  status: { type: String, default: 'active' },
  ownerUserId: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { ...baseOptions, collection: 'surveys' });

surveySchema.index({ ownerUserId: 1, id: 1 }, { unique: true, name: 'owner_survey_id_unique' });

const questionSchema = new Schema({
  id: { type: String, required: true },
  backendId: { type: String, index: true },
  surveyId: { type: String, default: 'survey1' },
  ownerUserId: { type: String, index: true },
  sequence: { type: Number, required: true },
  text: { type: String, required: true },
  type: { type: String, default: 'MCQ' },
  options: { type: [String], default: [] },
  hasVoice: { type: Boolean, default: false },
  isMandatory: { type: Boolean, default: false },
  archived: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { ...baseOptions, collection: 'questions' });

questionSchema.index({ ownerUserId: 1, surveyId: 1, id: 1 }, { unique: true, name: 'owner_survey_question_id_unique' });
questionSchema.index({ ownerUserId: 1, surveyId: 1, sequence: 1 }, { name: 'owner_survey_sequence_idx' });

const questionTransitionSchema = new Schema({
  fromId: { type: String, required: true },
  toId: { type: String },
  type: { type: String, default: 'next' },
  optionIndex: { type: Number },
  surveyId: { type: String, default: 'survey1' },
  ownerUserId: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { ...baseOptions, collection: 'questionTransitions' });

questionTransitionSchema.index({ ownerUserId: 1, surveyId: 1, fromId: 1, type: 1, optionIndex: 1 }, { name: 'owner_survey_transition_idx' });

const answerSchema = new Schema({
  id: { type: String, index: true },
  phoneNumber: { type: String, index: true },
  sessionId: { type: String, index: true },
  questionId: { type: String, index: true },
  questionBackendId: { type: String, index: true },
  selectedOption: { type: String },
  selectedOptionIndex: { type: Number },
  answerText: { type: String },
  audioId: { type: String, index: true },
  surveyId: { type: String, default: 'survey1' },
  ownerUserId: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { ...baseOptions, collection: 'answers' });

const farmerSchema = new Schema({
  phoneNumber: { type: String, index: true },
  preferredLanguage: { type: String },
  region: { type: String },
  status: { type: String },
  ownerUserId: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { ...baseOptions, collection: 'farmers' });

farmerSchema.index({ ownerUserId: 1, phoneNumber: 1 }, { name: 'owner_farmer_phone_idx' });

const surveySessionSchema = new Schema({
  id: { type: String, index: true },
  phoneNumber: { type: String, index: true },
  status: { type: String, index: true },
  surveyId: { type: String, default: 'survey1' },
  ownerUserId: { type: String, index: true },
  startedAt: { type: Date },
  completedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { ...baseOptions, collection: 'surveySessions' });

const audioSchema = new Schema({
  id: { type: String, index: true },
  audioId: { type: String, index: true },
  fileName: { type: String },
  filePath: { type: String },
  mimeType: { type: String },
  fileSize: { type: Number },
  sessionId: { type: String },
  questionId: { type: String },
  phoneNumber: { type: String },
  source: { type: String },
  qc: { type: Schema.Types.Mixed },
  transcript: { type: Schema.Types.Mixed },
  transcriptionStatus: { type: String },
  ownerUserId: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { ...baseOptions, collection: 'audio' });

const regionSchema = new Schema({
  phoneNumber: { type: String, index: true },
  region: { type: String },
  ownerUserId: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { ...baseOptions, collection: 'regions' });

const inviteJobSchema = new Schema({
  id: { type: String, index: true },
  ownerUserId: { type: String, index: true },
  status: { type: String, index: true },
  totalCount: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  failureCount: { type: Number, default: 0 },
  processedCount: { type: Number, default: 0 },
  failures: { type: [Schema.Types.Mixed], default: [] },
  error: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  startedAt: { type: Date },
  completedAt: { type: Date },
}, { ...baseOptions, collection: 'inviteJobs' });

const webhookEventSchema = new Schema({
  messageId: { type: String, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
}, { ...baseOptions, collection: 'webhookEvents' });

const webhookDebugSchema = new Schema({
  receivedAt: { type: Date, default: Date.now, index: true },
  kind: { type: String },
  payload: { type: Schema.Types.Mixed },
}, { ...baseOptions, collection: 'webhookDebug' });

export const UserModel = mongoose.models.User || mongoose.model('User', userSchema);
export const SurveyModel = mongoose.models.Survey || mongoose.model('Survey', surveySchema);
export const QuestionModel = mongoose.models.Question || mongoose.model('Question', questionSchema);
export const QuestionTransitionModel = mongoose.models.QuestionTransition || mongoose.model('QuestionTransition', questionTransitionSchema);
export const AnswerModel = mongoose.models.Answer || mongoose.model('Answer', answerSchema);
export const FarmerModel = mongoose.models.Farmer || mongoose.model('Farmer', farmerSchema);
export const SurveySessionModel = mongoose.models.SurveySession || mongoose.model('SurveySession', surveySessionSchema);
export const AudioModel = mongoose.models.Audio || mongoose.model('Audio', audioSchema);
export const RegionModel = mongoose.models.Region || mongoose.model('Region', regionSchema);
export const InviteJobModel = mongoose.models.InviteJob || mongoose.model('InviteJob', inviteJobSchema);
export const WebhookEventModel = mongoose.models.WebhookEvent || mongoose.model('WebhookEvent', webhookEventSchema);
export const WebhookDebugModel = mongoose.models.WebhookDebug || mongoose.model('WebhookDebug', webhookDebugSchema);

const modelByCollection = {
  users: UserModel,
  surveys: SurveyModel,
  questions: QuestionModel,
  questionTransitions: QuestionTransitionModel,
  answers: AnswerModel,
  farmers: FarmerModel,
  surveySessions: SurveySessionModel,
  audio: AudioModel,
  regions: RegionModel,
  inviteJobs: InviteJobModel,
  webhookEvents: WebhookEventModel,
  webhookDebug: WebhookDebugModel,
};

export const getModelByCollection = (collectionName) => {
  const model = modelByCollection[collectionName];
  if (!model) {
    throw new Error(`No mongoose model registered for collection: ${collectionName}`);
  }
  return model;
};
