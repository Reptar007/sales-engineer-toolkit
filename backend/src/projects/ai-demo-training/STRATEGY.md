# Strategy: Lesson Plan Generator from Gong Transcripts

## Overview

This document outlines a step-by-step approach to build a Ralph Wiggum Loop-based system that generates lesson plans from Gong call transcripts. This is a **strategy guide only** - no code is provided.

## High-Level Architecture

### Data Flow

1. **Input**: Raw Gong transcripts (text files)
2. **Processing**: Parse, clean, extract metadata
3. **ML Analysis**: Generate embeddings, identify key moments, cluster patterns
4. **Ralph Loop**: Iterative AI generation until validation passes
5. **Output**: Structured lesson plan (JSON)

## Phase 1: Data Collection & Preparation

### Step 1.1: Transcript Collection

- Export transcripts from Gong in your preferred format (CSV, JSON, or plain text)
- Create a `data/raw/` directory structure
- Organize by date, customer, or demo type
- Each transcript should preserve:
  - Participant names and roles
  - Timestamps for each speaker turn
  - Full conversation text
  - Metadata (date, duration, meeting title)

**File Naming Convention:**

- **Recommended format:** `YYYY-MM-DD_customer_demo-type.txt`
- **Example:** `2025-05-28_riskonnect_claims-demo.txt`
- **Key principles:**
  - Start with date (YYYY-MM-DD) for easy sorting
  - Include customer/company name
  - Include demo type or topic
  - Use hyphens or underscores (avoid spaces)
  - Keep it descriptive but concise
- **Alternative formats:**

### Step 1.2: Data Cleaning Script

**What to build:**

- Parser to extract structured data from raw transcripts
- Cleaner to remove filler words, false starts, "um", "uh"
- Normalizer for speaker names (handle variations)
- Metadata extractor (date, duration, participants)

**Considerations:**

- Handle different transcript formats
- Preserve timestamps for later reference
- Maintain speaker attribution
- Handle special characters and encoding

## Phase 2: ML-Based Analysis

### Step 2.1: Embedding Generation

**Approach:**

- Use OpenAI's `text-embedding-3-small` or similar
- Chunk transcripts into segments (by speaker turn or time windows)
- Generate embeddings for each segment
- Store embeddings for similarity search

**Why this matters:**

- Enables semantic search for similar demo moments
- Helps identify recurring patterns across transcripts
- Supports clustering of related content

### Step 2.2: Key Moment Extraction

**What to identify:**

- Demo walkthroughs (where SE shows the product)
- Technical explanations (deep dives)
- Objection handling moments
- Customer questions and responses
- Best practice demonstrations

**How:**

- Use similarity search to find high-value segments
- Score segments by relevance to training objectives
- Extract timestamps and context for each moment

### Step 2.3: Clustering & Categorization

**Group similar content:**

- Cluster demo flows that follow similar patterns
- Group objection handling by type
- Identify common technical explanations
- Extract recurring best practices

**Tools to consider:**

- K-means or hierarchical clustering on embeddings
- Topic modeling (LDA, BERTopic)
- Simple similarity thresholds

## Phase 3: Ralph Wiggum Loop Implementation

### Step 3.1: Loop Structure

**Core components:**

1. **Loop Controller**: Bash/Python script that runs until "done"
2. **State File**: JSON file tracking progress (e.g., `state.json`)
3. **Validation Function**: Checks if lesson plan is complete
4. **AI Agent**: Calls OpenAI API with prompts

**Loop Logic:**

```
WHILE not done:
  - Read current state
  - Generate/update lesson plan via AI
  - Validate output
  - Update state file
  - If validation passes: set done = true
  - If max iterations reached: exit with error
```

### Step 3.2: Prompt Engineering

**System Prompt should:**

- Define the lesson plan structure
- Specify output format (JSON matching schema)
- Include quality criteria
- Set tone and style expectations

**User Prompt should:**

- Include processed transcript data
- Reference previous iterations (if any)
- Specify what section to work on
- Include context from ML analysis

**Iteration Strategy:**

- First iteration: Generate full structure
- Subsequent iterations: Refine specific sections
- Use previous output as context
- Focus on gaps identified by validation

### Step 3.3: Validation Criteria

**Define "done" as:**

1. All required sections present (metadata, objectives, sections, etc.)
2. Schema validation passes (JSON structure matches schema)
3. Quality score above threshold (coverage, clarity, actionability)
4. Minimum content requirements met:
   - At least 3 learning objectives
   - At least 5 lesson sections
   - At least 2 practice exercises
5. No critical structural errors

**Quality Scoring:**

- Coverage: Does it cover key demo moments?
- Clarity: Are explanations clear and actionable?
- Completeness: Are all important topics included?
- Structure: Does it follow the schema correctly?

## Phase 4: Lesson Plan Structure

### Required Sections

1. **Metadata**
   - Source transcript identifier
   - Date and duration
   - Participants (names, roles, companies)

2. **Learning Objectives**
   - 3+ clear, actionable objectives
   - What SEs should learn/be able to do

3. **Sections** (5+ required)
   - Each section should have:
     - Title
     - Type (demo_moment, technical_deep_dive, objection_handling, etc.)
     - Timestamp reference
     - Content/explanation
     - Key points
     - Speaker attribution

4. **Exercises** (2+ required)
   - Practice activities for SEs
   - Types: demo_practice, objection_response, technical_explanation
   - Estimated time

5. **Assessment**
   - Criteria for measuring success
   - Rubric for evaluation

### Section Types

- `demo_moment`: Product demonstration highlights
- `technical_deep_dive`: Detailed technical explanations
- `objection_handling`: How objections were addressed
- `best_practice`: Effective techniques demonstrated
- `key_insight`: Important realizations or learnings
- `customer_interaction`: Notable customer engagement moments

## Phase 5: Implementation Decisions

### Python vs Node.js

**Python Advantages:**

- Better ML libraries (sentence-transformers, scikit-learn, numpy)
- Easier embedding generation and clustering
- More flexible for data analysis
- Better for prototyping ML approaches

**Node.js Advantages:**

- Consistent with existing codebase
- Can use existing OpenAI service
- Simpler deployment (no separate Python environment)
- Easier integration with backend

**Recommendation:** Start with Python for ML analysis, use Node.js for the Ralph Loop if you want consistency.

### File Structure

```
ai-demo-training/
├── data/
│   ├── raw/              # Original transcripts
│   ├── processed/        # Cleaned, structured data
│   ├── embeddings/       # Generated embeddings
│   └── lessons/          # Generated lesson plans
├── scripts/
│   ├── parse_transcript.js/py
│   ├── generate_embeddings.py
│   ├── extract_key_moments.py
│   ├── ralph_loop.js/py
│   └── validate_lesson.js/py
├── schema/
│   └── lesson.schema.json
├── config.json
└── state.json            # Loop state tracking
```

### Configuration Needs

- Max iterations for Ralph Loop
- Quality thresholds
- OpenAI model selection
- Embedding model selection
- Chunk sizes for processing
- Validation rules

## Phase 6: Testing & Iteration

### Start Small

1. Process one transcript manually first
2. Identify what works and what doesn't
3. Refine prompts based on output quality
4. Adjust validation criteria

### Scale Up

1. Process multiple transcripts
2. Compare outputs for consistency
3. Identify patterns across transcripts
4. Build a library of good examples

### Continuous Improvement

- Collect feedback from SEs using the lessons
- Refine prompts based on what's most useful
- Adjust ML parameters for better key moment extraction
- Update validation criteria as you learn what makes a good lesson

## Key Considerations

### Prompt Design

- Be specific about output format
- Include examples of good sections
- Reference the schema explicitly
- Guide the AI on what makes content valuable for training

### Validation Strategy

- Start with strict validation (all sections required)
- Gradually refine based on what's actually needed
- Balance completeness with quality
- Consider partial completion (mark sections as draft)

### Error Handling

- What if AI generates invalid JSON?
- What if validation never passes?
- How to handle API rate limits?
- What if transcript is too short/long?

### Performance

- How long should each iteration take?
- How many API calls per iteration?
- Can you batch process multiple transcripts?
- How to handle large transcripts (token limits)?

## Success Metrics

**Technical:**

- Validation pass rate
- Average iterations to completion
- Quality score distribution
- Processing time per transcript

**Business:**

- SE feedback on lesson usefulness
- Time saved vs manual lesson creation
- Coverage of key demo moments
- Actionability of exercises

## Next Steps

1. **Set up data structure**: Create directories, decide on file formats
2. **Build transcript parser**: Extract structured data from raw transcripts
3. **Implement embedding generation**: Process one transcript as proof of concept
4. **Create basic Ralph Loop**: Simple version that generates and validates
5. **Refine iteratively**: Improve prompts, validation, and ML analysis based on results

## Resources to Consider

- OpenAI Embeddings API documentation
- JSON Schema validation libraries
- Clustering algorithms (scikit-learn, etc.)
- Similarity search libraries (FAISS, Pinecone, etc.)
- Prompt engineering best practices
