# Content Hoarder Trik Design

## Overview

A trik for hoarding content from URLs (single articles and feeds), storing them as searchable content pieces, and generating articles in the user's voice based on selected content.

## Core Concepts

### Inspirations
URLs provided by the user. Can be:
- **Single content**: Blog posts, articles, web pages
- **Feeds**: RSS/Atom feeds containing multiple items

### Content
Individual pieces of extracted content stored in the trik. Each content piece includes:
- Extracted title, text, author, publication date
- Auto-generated tags (via LLM)
- Source inspiration reference
- Optional `isVoiceSample` flag for user's own writing

### Articles
Content created by the user through this trik:
- **Draft**: Work in progress, can be revised
- **Published**: Finalized, contributes to voice profile

### Voice Profile
Auto-generated analysis of the user's writing style, built from:
- Initial voice samples (URLs to user's existing posts)
- Published articles created through the trik

Regenerated automatically when an article is published.

## Data Model

### Storage Schema

```typescript
interface Inspiration {
  id: string;
  url: string;
  type: 'feed' | 'single';
  title?: string;
  lastFetchedAt: number;
  createdAt: number;
}

interface Content {
  id: string;
  inspirationId: string;
  url: string;
  title: string;
  content: string;           // Extracted text
  author?: string;
  publishedAt?: number;
  tags: string[];            // Auto-generated
  isVoiceSample: boolean;    // User's own writing
  createdAt: number;
}

interface Article {
  id: string;
  title: string;
  content: string;           // Markdown
  status: 'draft' | 'published';
  sourceContentIds: string[];
  instructions?: string;     // Original creation instructions
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
}

interface VoiceProfile {
  analysis: string;          // LLM-generated style analysis
  sampleCount: number;
  lastUpdatedAt: number;
}
```

## Actions

### `addVoiceSample`
Add a URL to the user's own writing as a voice sample.

- **Input**: `{ url: string }`
- **Behavior**: Fetch URL, extract content, store with `isVoiceSample: true`, regenerate voice profile
- **Response Mode**: template
- **Templates**: `success`, `fetch_error`, `extraction_error`

### `addInspiration`
Add a URL to hoard content from. Auto-detects feed vs single content.

- **Input**: `{ url: string }`
- **Behavior**:
  - Detect if URL is RSS/Atom feed or single page
  - For feeds: parse and store all items as individual content
  - For single: extract and store as one content piece
  - Auto-tag all content with LLM
- **Response Mode**: template
- **Templates**: `feed_added` (with count), `content_added`, `fetch_error`

### `syncFeeds`
Re-fetch all feed inspirations for new content.

- **Input**: `{}` (no input required)
- **Behavior**: Iterate all feed inspirations, fetch new items, auto-tag
- **Response Mode**: template
- **Templates**: `synced` (with new content count), `no_feeds`, `error`

### `search`
Search hoarded content by query. Results stored in session for use with `create`.

- **Input**: `{ query: string, tags?: string[], limit?: number }`
- **Behavior**: Search content by text/tags, store results in session
- **Response Mode**: template
- **Agent Data**: `{ count, contentIds[], query }`
- **Templates**: `found`, `empty`

### `listContent`
List stored content with optional filters.

- **Input**: `{ tags?: string[], limit?: number, offset?: number }`
- **Response Mode**: passthrough
- **User Content**: Formatted list of content titles and summaries

### `create`
Generate an article from selected content using voice profile.

- **Input**: `{ instructions: string, contentIds?: string[] }`
- **Behavior**:
  - Use `contentIds` if provided, otherwise use session selection from `search`
  - Load voice profile
  - Generate article using LLM with content + voice + instructions
  - Store as draft, set as current article in session
- **Response Mode**: passthrough
- **User Content**: Generated article markdown

### `revise`
Edit the current draft article with feedback.

- **Input**: `{ feedback: string, articleId?: string }`
- **Behavior**:
  - Use `articleId` if provided, otherwise use current article from session
  - Apply feedback via LLM
  - Update draft
- **Response Mode**: passthrough
- **User Content**: Revised article markdown

### `publish`
Mark an article as published. Triggers voice profile regeneration.

- **Input**: `{ articleId?: string }`
- **Behavior**:
  - Mark article as published
  - Add article content to voice samples
  - Regenerate voice profile from all samples
- **Response Mode**: template
- **Templates**: `published`, `not_found`, `already_published`

### `listArticles`
List user's articles with status filter.

- **Input**: `{ status?: 'draft' | 'published', limit?: number }`
- **Response Mode**: passthrough
- **User Content**: Formatted list of articles

## Session State

```typescript
interface SessionState {
  currentSearchResults?: string[];  // Content IDs from last search
  currentArticleId?: string;        // Draft being worked on
}
```

Session enables conversational flow:
1. "Search for AI articles" → stores content IDs
2. "Create an article about emerging trends" → uses stored IDs
3. "Make it shorter" → revises current article

## Voice Profile Generation

The voice profile is an LLM-generated analysis including:
- Tone (formal/casual, technical/accessible)
- Sentence structure patterns
- Vocabulary preferences
- Opening/closing patterns
- Use of examples, analogies, humor

**Regeneration triggers:**
- Initial: When first voice sample is added
- On publish: When any article is marked as published

**Prompt structure:**
```
Analyze these writing samples and create a detailed style guide:

[Sample 1]
...

[Sample N]

Create a comprehensive style guide covering:
1. Overall tone and voice
2. Sentence structure preferences
3. Vocabulary and word choice patterns
4. How ideas are introduced and concluded
5. Use of examples, analogies, or humor
6. Any distinctive stylistic patterns
```

## Content Extraction

Use a readability algorithm (like Mozilla Readability or similar) to extract:
- Title
- Main content text
- Author (if available)
- Publication date (if available)

For feeds (RSS/Atom):
- Parse feed structure
- Extract each item's link
- Fetch and extract each linked article

## Auto-Tagging

After content extraction, use LLM to generate 3-5 relevant tags:

```
Given this article:
Title: {title}
Content: {content preview}

Generate 3-5 descriptive tags as a JSON array.
Tags should be lowercase, single words or short phrases.
```

## Configuration

Required API keys:
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` or `GOOGLE_API_KEY` (for LLM operations)

## Capabilities

```json
{
  "capabilities": {
    "storage": { "enabled": true },
    "session": {
      "enabled": true,
      "maxDurationMs": 3600000,
      "maxHistoryEntries": 20
    }
  }
}
```

## Error Handling

- **URL fetch failures**: Return error template with URL, don't crash
- **Feed parse failures**: Try single-page extraction as fallback
- **LLM failures**: Return error template, preserve any partial state
- **Missing content**: Return not_found template with helpful message

## Security Considerations

All `agentDataSchema` fields use constrained types:
- `template` fields use enums
- `count` fields are integers
- `contentIds` and `articleIds` use format: "id"
- No free-form strings in agent data

User content (article text, content text) goes through passthrough mode.
