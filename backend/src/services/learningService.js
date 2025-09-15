// Learning Service for AI Improvement
import fs from 'fs/promises';
import path from 'path';

class LearningService {
  constructor() {
    this.learningDataPath = path.join(process.cwd(), 'data', 'learning');
    this.feedbackHistory = [];
    this.patterns = new Map();
    this.initializeLearningData();
  }

  async initializeLearningData() {
    try {
      await fs.mkdir(this.learningDataPath, { recursive: true });
      await this.loadLearningData();
    } catch (error) {
      console.error('Failed to initialize learning data:', error);
    }
  }

  async loadLearningData() {
    try {
      const feedbackFile = path.join(this.learningDataPath, 'feedback-history.json');
      const patternsFile = path.join(this.learningDataPath, 'learned-patterns.json');

      const feedbackData = await fs.readFile(feedbackFile, 'utf-8');
      this.feedbackHistory = JSON.parse(feedbackData);

      const patternsData = await fs.readFile(patternsFile, 'utf-8');
      const patternsObj = JSON.parse(patternsData);
      this.patterns = new Map(Object.entries(patternsObj));
    } catch {
      // Files don't exist yet, start fresh
      this.feedbackHistory = [];
      this.patterns = new Map();
    }
  }

  async saveLearningData() {
    try {
      const feedbackFile = path.join(this.learningDataPath, 'feedback-history.json');
      const patternsFile = path.join(this.learningDataPath, 'learned-patterns.json');

      await fs.writeFile(feedbackFile, JSON.stringify(this.feedbackHistory, null, 2));
      await fs.writeFile(patternsFile, JSON.stringify(Object.fromEntries(this.patterns), null, 2));
    } catch (error) {
      console.error('Failed to save learning data:', error);
    }
  }

  // Record feedback for learning
  recordFeedback(phase, feedback) {
    const learningEntry = {
      timestamp: new Date().toISOString(),
      phase,
      feedback,
      context: this.extractContext(feedback),
    };

    this.feedbackHistory.push(learningEntry);
    this.extractPatterns(learningEntry);
    this.saveLearningData();
  }

  // Extract context from feedback
  extractContext(feedback) {
    const context = {
      commonIssues: [],
      preferredEstimates: new Map(),
      featureGrouping: new Map(),
      testNaming: new Map(),
    };

    if (feedback.rejectedTests) {
      feedback.rejectedTests.forEach((rejection) => {
        // Track common rejection reasons
        const reason = rejection.reason.toLowerCase();
        if (reason.includes('too high') || reason.includes('too many')) {
          context.commonIssues.push('over-estimation');
        } else if (reason.includes('too low') || reason.includes('too few')) {
          context.commonIssues.push('under-estimation');
        }

        // Track preferred estimates
        if (rejection.suggestedCount) {
          const key = `${rejection.testId}-${rejection.originalCount}`;
          context.preferredEstimates.set(key, rejection.suggestedCount);
        }
      });
    }

    return context;
  }

  // Extract patterns from feedback
  extractPatterns(learningEntry) {
    const { feedback, context } = learningEntry;

    // Pattern 1: Feature Grouping Preferences
    if (feedback.approvedTests) {
      feedback.approvedTests.forEach((testId) => {
        const pattern = `feature-grouping-${testId}`;
        this.patterns.set(pattern, {
          type: 'feature-grouping',
          confidence: 1,
          lastSeen: learningEntry.timestamp,
        });
      });
    }

    // Pattern 2: Estimation Patterns
    if (context.preferredEstimates.size > 0) {
      context.preferredEstimates.forEach((preferred, key) => {
        const pattern = `estimation-${key}`;
        this.patterns.set(pattern, {
          type: 'estimation',
          preferredValue: preferred,
          confidence: 1,
          lastSeen: learningEntry.timestamp,
        });
      });
    }

    // Pattern 3: Common Issues
    context.commonIssues.forEach((issue) => {
      const pattern = `common-issue-${issue}`;
      const existing = this.patterns.get(pattern) || { count: 0, confidence: 0 };
      this.patterns.set(pattern, {
        ...existing,
        count: existing.count + 1,
        confidence: Math.min(existing.confidence + 0.1, 1),
        lastSeen: learningEntry.timestamp,
      });
    });
  }

  // Generate learning-enhanced prompts
  generateLearningContext() {
    const recentFeedback = this.feedbackHistory.slice(-10); // Last 10 feedback entries
    const highConfidencePatterns = Array.from(this.patterns.entries())
      .filter(([, pattern]) => pattern.confidence > 0.7)
      .map(([key, pattern]) => ({ key, ...pattern }));

    return {
      recentFeedback,
      learnedPatterns: highConfidencePatterns,
      totalLearningEntries: this.feedbackHistory.length,
      learningInsights: this.generateInsights(),
    };
  }

  // Generate insights from learning data
  generateInsights() {
    const insights = {
      commonOverEstimations: 0,
      commonUnderEstimations: 0,
      preferredFeatureGroups: new Set(),
      averageEstimationAdjustment: 0,
    };

    this.feedbackHistory.forEach((entry) => {
      if (entry.context.commonIssues.includes('over-estimation')) {
        insights.commonOverEstimations++;
      }
      if (entry.context.commonIssues.includes('under-estimation')) {
        insights.commonUnderEstimations++;
      }
    });

    return insights;
  }

  // Get personalized prompt enhancements
  getPersonalizedEnhancements() {
    const learningContext = this.generateLearningContext();

    let enhancements = [];

    if (learningContext.learningInsights.commonOverEstimations > 3) {
      enhancements.push(
        'Tendency to over-estimate detected. Be more conservative with test counts.',
      );
    }

    if (learningContext.learningInsights.commonUnderEstimations > 3) {
      enhancements.push(
        'Tendency to under-estimate detected. Consider more comprehensive test coverage.',
      );
    }

    if (learningContext.learnedPatterns.length > 0) {
      enhancements.push(
        `Apply ${learningContext.learnedPatterns.length} learned patterns from previous feedback.`,
      );
    }

    return enhancements;
  }
}

export const learningService = new LearningService();
