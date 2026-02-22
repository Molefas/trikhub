# Content Hoarder Trik Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a trik that hoards content from URLs, maintains a voice profile, and generates articles in the user's style.

**Architecture:** Session-driven workflow with persistent storage. Actions are independent but use session context for conversational flow. Voice profile auto-regenerates on article publish.

**Tech Stack:** TypeScript, @trikhub/gateway, @trikhub/manifest, node-fetch, @extractus/article-extractor, rss-parser, Anthropic/OpenAI SDK

---

## Phase 1: Project Setup

### Task 1.1: Initialize Project Directory

**Files:**
- Create: `trikhub-skills/content-hoarder/`

**Step 1: Create directory structure**

```bash
cd /Users/ruimolefas/Code/trikhub-skills
mkdir -p content-hoarder/src/{actions,services}
mkdir -p content-hoarder/tests
cd content-hoarder
```

**Step 2: Initialize git**

```bash
git init
echo "node_modules/\ndist/\n.env" > .gitignore
```

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: initialize content-hoarder trik"
```

---

### Task 1.2: Create package.json

**Files:**
- Create: `content-hoarder/package.json`

**Step 1: Create package.json**

```json
{
  "name": "@molefas/trik-content-hoarder",
  "version": "0.1.0",
  "description": "Hoard content, build voice profile, generate articles",
  "type": "module",
  "main": "dist/graph.js",
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublish": "npm run build"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@extractus/article-extractor": "^8.0.0",
    "rss-parser": "^3.13.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@trikhub/gateway": "^0.7.0",
    "@trikhub/manifest": "^0.7.0",
    "@types/node": "^20.0.0",
    "@types/uuid": "^9.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^1.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

**Step 2: Install dependencies**

```bash
npm install
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add package.json with dependencies"
```

---

### Task 1.3: Create TypeScript Config

**Files:**
- Create: `content-hoarder/tsconfig.json`

**Step 1: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 2: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add TypeScript config"
```

---

### Task 1.4: Create trikhub.json

**Files:**
- Create: `content-hoarder/trikhub.json`

**Step 1: Create trikhub.json**

```json
{
  "displayName": "Content Hoarder",
  "shortDescription": "Hoard content, build voice profile, generate articles in your style",
  "categories": ["content", "productivity", "writing"],
  "keywords": ["articles", "rss", "feeds", "writing", "voice", "content-creation"],
  "author": {
    "name": "Molefas",
    "github": "Molefas"
  },
  "repository": "https://github.com/Molefas/trik-content-hoarder",
  "homepage": "https://github.com/Molefas/trik-content-hoarder"
}
```

**Step 2: Commit**

```bash
git add trikhub.json
git commit -m "chore: add trikhub registry metadata"
```

---

### Task 1.5: Create Manifest (Actions Schema)

**Files:**
- Create: `content-hoarder/manifest.json`

**Step 1: Create manifest.json**

```json
{
  "schemaVersion": 1,
  "id": "content-hoarder",
  "name": "Content Hoarder",
  "description": "Hoard content from URLs and feeds, maintain a voice profile from your writing samples, and generate articles in your style.",
  "version": "0.1.0",

  "actions": {
    "addVoiceSample": {
      "description": "Add a URL to your own writing as a voice sample for style learning",
      "responseMode": "template",
      "inputSchema": {
        "type": "object",
        "properties": {
          "url": { "type": "string", "format": "uri", "description": "URL to your published writing" }
        },
        "required": ["url"]
      },
      "agentDataSchema": {
        "type": "object",
        "properties": {
          "template": { "type": "string", "enum": ["success", "fetch_error", "extraction_error"] },
          "title": { "type": "string", "maxLength": 200 },
          "sampleCount": { "type": "integer" }
        },
        "required": ["template"]
      },
      "responseTemplates": {
        "success": { "text": "Added voice sample: \"{{title}}\". You now have {{sampleCount}} voice samples." },
        "fetch_error": { "text": "Could not fetch the URL. Please check if it's accessible." },
        "extraction_error": { "text": "Could not extract content from the page. The page may be behind a paywall or have unusual structure." }
      }
    },

    "addInspiration": {
      "description": "Add a URL to hoard content from. Automatically detects RSS/Atom feeds vs single articles.",
      "responseMode": "template",
      "inputSchema": {
        "type": "object",
        "properties": {
          "url": { "type": "string", "format": "uri", "description": "URL to article or RSS/Atom feed" }
        },
        "required": ["url"]
      },
      "agentDataSchema": {
        "type": "object",
        "properties": {
          "template": { "type": "string", "enum": ["feed_added", "content_added", "fetch_error", "extraction_error"] },
          "type": { "type": "string", "enum": ["feed", "single"] },
          "title": { "type": "string", "maxLength": 200 },
          "count": { "type": "integer" }
        },
        "required": ["template"]
      },
      "responseTemplates": {
        "feed_added": { "text": "Added feed \"{{title}}\" with {{count}} articles." },
        "content_added": { "text": "Added content: \"{{title}}\"." },
        "fetch_error": { "text": "Could not fetch the URL. Please check if it's accessible." },
        "extraction_error": { "text": "Could not extract content from the page." }
      }
    },

    "syncFeeds": {
      "description": "Re-fetch all feed inspirations to check for new content",
      "responseMode": "template",
      "inputSchema": {
        "type": "object",
        "properties": {}
      },
      "agentDataSchema": {
        "type": "object",
        "properties": {
          "template": { "type": "string", "enum": ["synced", "no_feeds", "error"] },
          "feedCount": { "type": "integer" },
          "newContentCount": { "type": "integer" }
        },
        "required": ["template"]
      },
      "responseTemplates": {
        "synced": { "text": "Synced {{feedCount}} feeds. Found {{newContentCount}} new articles." },
        "no_feeds": { "text": "No feeds to sync. Add some feed URLs first with addInspiration." },
        "error": { "text": "Error syncing feeds. Some feeds may not have been updated." }
      }
    },

    "search": {
      "description": "Search hoarded content by query. Results are stored in session for use with create action.",
      "responseMode": "template",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search query" },
          "tags": { "type": "array", "items": { "type": "string" }, "description": "Filter by tags" },
          "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
        },
        "required": ["query"]
      },
      "agentDataSchema": {
        "type": "object",
        "properties": {
          "template": { "type": "string", "enum": ["found", "empty"] },
          "count": { "type": "integer" },
          "contentIds": { "type": "array", "items": { "type": "string", "format": "uuid" } }
        },
        "required": ["template"]
      },
      "responseTemplates": {
        "found": { "text": "Found {{count}} relevant content pieces. Ready to create an article from these." },
        "empty": { "text": "No content found matching your query. Try different search terms or add more inspirations." }
      }
    },

    "listContent": {
      "description": "List stored content with optional tag filter",
      "responseMode": "passthrough",
      "inputSchema": {
        "type": "object",
        "properties": {
          "tags": { "type": "array", "items": { "type": "string" } },
          "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 },
          "offset": { "type": "integer", "minimum": 0, "default": 0 }
        }
      },
      "userContentSchema": {
        "type": "object",
        "properties": {
          "contentType": { "type": "string", "enum": ["content-list"] },
          "content": { "type": "string" },
          "metadata": {
            "type": "object",
            "properties": {
              "count": { "type": "integer" },
              "total": { "type": "integer" }
            }
          }
        },
        "required": ["contentType", "content"]
      },
      "agentDataSchema": {
        "type": "object",
        "properties": {
          "template": { "type": "string", "enum": ["empty", "error"] }
        }
      },
      "responseTemplates": {
        "empty": { "text": "No content stored yet. Add some inspirations first." },
        "error": { "text": "Error listing content." }
      }
    },

    "create": {
      "description": "Generate an article from selected content using your voice profile",
      "responseMode": "passthrough",
      "inputSchema": {
        "type": "object",
        "properties": {
          "instructions": { "type": "string", "description": "What kind of article to write and any specific guidance" },
          "contentIds": { "type": "array", "items": { "type": "string" }, "description": "Content IDs to use. If omitted, uses last search results." }
        },
        "required": ["instructions"]
      },
      "userContentSchema": {
        "type": "object",
        "properties": {
          "contentType": { "type": "string", "enum": ["article"] },
          "content": { "type": "string" },
          "metadata": {
            "type": "object",
            "properties": {
              "articleId": { "type": "string" },
              "title": { "type": "string" }
            }
          }
        },
        "required": ["contentType", "content"]
      },
      "agentDataSchema": {
        "type": "object",
        "properties": {
          "template": { "type": "string", "enum": ["no_content", "no_voice", "error"] }
        }
      },
      "responseTemplates": {
        "no_content": { "text": "No content selected. Search for content first or provide contentIds." },
        "no_voice": { "text": "No voice profile found. Add some voice samples first with addVoiceSample." },
        "error": { "text": "Error generating article. Please try again." }
      }
    },

    "revise": {
      "description": "Edit the current draft article with feedback",
      "responseMode": "passthrough",
      "inputSchema": {
        "type": "object",
        "properties": {
          "feedback": { "type": "string", "description": "What changes to make (e.g., 'make it shorter', 'add more examples')" },
          "articleId": { "type": "string", "description": "Article ID. If omitted, uses current article from session." }
        },
        "required": ["feedback"]
      },
      "userContentSchema": {
        "type": "object",
        "properties": {
          "contentType": { "type": "string", "enum": ["article"] },
          "content": { "type": "string" },
          "metadata": {
            "type": "object",
            "properties": {
              "articleId": { "type": "string" },
              "title": { "type": "string" }
            }
          }
        },
        "required": ["contentType", "content"]
      },
      "agentDataSchema": {
        "type": "object",
        "properties": {
          "template": { "type": "string", "enum": ["no_article", "not_found", "error"] }
        }
      },
      "responseTemplates": {
        "no_article": { "text": "No article to revise. Create one first." },
        "not_found": { "text": "Article not found." },
        "error": { "text": "Error revising article. Please try again." }
      }
    },

    "publish": {
      "description": "Mark an article as published. This adds it to voice samples and regenerates the voice profile.",
      "responseMode": "template",
      "inputSchema": {
        "type": "object",
        "properties": {
          "articleId": { "type": "string", "description": "Article ID. If omitted, uses current article from session." }
        }
      },
      "agentDataSchema": {
        "type": "object",
        "properties": {
          "template": { "type": "string", "enum": ["published", "not_found", "already_published", "error"] },
          "title": { "type": "string", "maxLength": 200 },
          "sampleCount": { "type": "integer" }
        },
        "required": ["template"]
      },
      "responseTemplates": {
        "published": { "text": "Published \"{{title}}\"! Added to voice samples (now {{sampleCount}} total). Voice profile updated." },
        "not_found": { "text": "Article not found." },
        "already_published": { "text": "This article is already published." },
        "error": { "text": "Error publishing article." }
      }
    },

    "listArticles": {
      "description": "List your articles",
      "responseMode": "passthrough",
      "inputSchema": {
        "type": "object",
        "properties": {
          "status": { "type": "string", "enum": ["draft", "published", "all"], "default": "all" },
          "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 }
        }
      },
      "userContentSchema": {
        "type": "object",
        "properties": {
          "contentType": { "type": "string", "enum": ["article-list"] },
          "content": { "type": "string" },
          "metadata": {
            "type": "object",
            "properties": {
              "count": { "type": "integer" }
            }
          }
        },
        "required": ["contentType", "content"]
      },
      "agentDataSchema": {
        "type": "object",
        "properties": {
          "template": { "type": "string", "enum": ["empty", "error"] }
        }
      },
      "responseTemplates": {
        "empty": { "text": "No articles yet. Create one with the create action." },
        "error": { "text": "Error listing articles." }
      }
    }
  },

  "capabilities": {
    "tools": [],
    "storage": { "enabled": true },
    "session": {
      "enabled": true,
      "maxDurationMs": 3600000,
      "maxHistoryEntries": 20
    }
  },

  "config": {
    "required": [],
    "optional": [
      { "key": "ANTHROPIC_API_KEY", "description": "Anthropic API key for Claude (priority 1)" },
      { "key": "OPENAI_API_KEY", "description": "OpenAI API key for GPT (priority 2)" }
    ]
  },

  "limits": {
    "maxExecutionTimeMs": 60000
  },

  "entry": {
    "module": "./dist/graph.js",
    "export": "default"
  }
}
```

**Step 2: Validate manifest structure**

```bash
# Check JSON is valid
node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"
```

**Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: add manifest with all action schemas"
```

---

## Phase 2: Core Types & Storage

### Task 2.1: Define TypeScript Types

**Files:**
- Create: `content-hoarder/src/types.ts`

**Step 1: Create types.ts**

```typescript
// Data Models

export interface Inspiration {
  id: string;
  url: string;
  type: 'feed' | 'single';
  title?: string;
  lastFetchedAt: number;
  createdAt: number;
}

export interface Content {
  id: string;
  inspirationId: string;
  url: string;
  title: string;
  content: string;
  author?: string;
  publishedAt?: number;
  tags: string[];
  isVoiceSample: boolean;
  createdAt: number;
}

export interface Article {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'published';
  sourceContentIds: string[];
  instructions?: string;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
}

export interface VoiceProfile {
  analysis: string;
  sampleCount: number;
  lastUpdatedAt: number;
}

// Storage Keys
export const STORAGE_KEYS = {
  INSPIRATIONS: 'inspirations',
  CONTENT: 'content',
  ARTICLES: 'articles',
  VOICE_PROFILE: 'voiceProfile',
} as const;

// Session State
export interface SessionState {
  currentSearchResults?: string[];
  currentArticleId?: string;
}

// Action Input Types
export interface AddVoiceSampleInput {
  url: string;
}

export interface AddInspirationInput {
  url: string;
}

export interface SearchInput {
  query: string;
  tags?: string[];
  limit?: number;
}

export interface ListContentInput {
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface CreateInput {
  instructions: string;
  contentIds?: string[];
}

export interface ReviseInput {
  feedback: string;
  articleId?: string;
}

export interface PublishInput {
  articleId?: string;
}

export interface ListArticlesInput {
  status?: 'draft' | 'published' | 'all';
  limit?: number;
}

// Trik Context (passed to actions)
export interface TrikContext {
  storage: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
  };
  config: Record<string, string>;
}

// Response Types
export interface TemplateResponse {
  responseMode: 'template';
  agentData: Record<string, unknown>;
}

export interface PassthroughResponse {
  responseMode: 'passthrough';
  userContent: {
    contentType: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
}

export type ActionResponse = TemplateResponse | PassthroughResponse;
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add TypeScript type definitions"
```

---

### Task 2.2: Create Storage Repository

**Files:**
- Create: `content-hoarder/src/services/repository.ts`
- Create: `content-hoarder/tests/repository.test.ts`

**Step 1: Write failing test**

```typescript
// tests/repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Repository } from '../src/services/repository.js';
import type { Content, Inspiration, Article, VoiceProfile } from '../src/types.js';

describe('Repository', () => {
  let repo: Repository;
  let mockStorage: Map<string, string>;

  beforeEach(() => {
    mockStorage = new Map();
    const storage = {
      get: async (key: string) => mockStorage.get(key) ?? null,
      set: async (key: string, value: string) => { mockStorage.set(key, value); },
    };
    repo = new Repository(storage);
  });

  describe('inspirations', () => {
    it('should save and retrieve inspiration', async () => {
      const inspiration: Inspiration = {
        id: 'insp-1',
        url: 'https://example.com/feed.xml',
        type: 'feed',
        title: 'Example Feed',
        lastFetchedAt: Date.now(),
        createdAt: Date.now(),
      };

      await repo.saveInspiration(inspiration);
      const result = await repo.getInspiration('insp-1');

      expect(result).toEqual(inspiration);
    });

    it('should list all inspirations', async () => {
      const insp1: Inspiration = { id: 'insp-1', url: 'https://a.com', type: 'feed', lastFetchedAt: 0, createdAt: 0 };
      const insp2: Inspiration = { id: 'insp-2', url: 'https://b.com', type: 'single', lastFetchedAt: 0, createdAt: 0 };

      await repo.saveInspiration(insp1);
      await repo.saveInspiration(insp2);

      const all = await repo.listInspirations();
      expect(all).toHaveLength(2);
    });
  });

  describe('content', () => {
    it('should save and search content', async () => {
      const content: Content = {
        id: 'cnt-1',
        inspirationId: 'insp-1',
        url: 'https://example.com/article',
        title: 'AI Revolution',
        content: 'Artificial intelligence is changing everything.',
        tags: ['ai', 'technology'],
        isVoiceSample: false,
        createdAt: Date.now(),
      };

      await repo.saveContent(content);
      const results = await repo.searchContent('artificial intelligence');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('cnt-1');
    });

    it('should filter by tags', async () => {
      const content1: Content = {
        id: 'cnt-1', inspirationId: 'i1', url: 'u1', title: 'AI Article',
        content: 'AI content', tags: ['ai'], isVoiceSample: false, createdAt: 0,
      };
      const content2: Content = {
        id: 'cnt-2', inspirationId: 'i2', url: 'u2', title: 'Web Article',
        content: 'Web content', tags: ['web'], isVoiceSample: false, createdAt: 0,
      };

      await repo.saveContent(content1);
      await repo.saveContent(content2);

      const results = await repo.listContent({ tags: ['ai'] });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('cnt-1');
    });

    it('should list voice samples', async () => {
      const sample: Content = {
        id: 'cnt-1', inspirationId: 'i1', url: 'u1', title: 'My Post',
        content: 'My writing', tags: [], isVoiceSample: true, createdAt: 0,
      };
      const other: Content = {
        id: 'cnt-2', inspirationId: 'i2', url: 'u2', title: 'Other',
        content: 'Other content', tags: [], isVoiceSample: false, createdAt: 0,
      };

      await repo.saveContent(sample);
      await repo.saveContent(other);

      const samples = await repo.getVoiceSamples();
      expect(samples).toHaveLength(1);
      expect(samples[0].id).toBe('cnt-1');
    });
  });

  describe('articles', () => {
    it('should save and retrieve article', async () => {
      const article: Article = {
        id: 'art-1',
        title: 'My Article',
        content: '# My Article\n\nContent here.',
        status: 'draft',
        sourceContentIds: ['cnt-1'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await repo.saveArticle(article);
      const result = await repo.getArticle('art-1');

      expect(result).toEqual(article);
    });

    it('should list articles by status', async () => {
      const draft: Article = {
        id: 'art-1', title: 'Draft', content: 'c', status: 'draft',
        sourceContentIds: [], createdAt: 0, updatedAt: 0,
      };
      const published: Article = {
        id: 'art-2', title: 'Published', content: 'c', status: 'published',
        sourceContentIds: [], createdAt: 0, updatedAt: 0, publishedAt: 0,
      };

      await repo.saveArticle(draft);
      await repo.saveArticle(published);

      const drafts = await repo.listArticles({ status: 'draft' });
      expect(drafts).toHaveLength(1);
      expect(drafts[0].id).toBe('art-1');
    });
  });

  describe('voiceProfile', () => {
    it('should save and retrieve voice profile', async () => {
      const profile: VoiceProfile = {
        analysis: 'Casual, technical tone...',
        sampleCount: 5,
        lastUpdatedAt: Date.now(),
      };

      await repo.saveVoiceProfile(profile);
      const result = await repo.getVoiceProfile();

      expect(result).toEqual(profile);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/repository.test.ts
```

Expected: FAIL - module not found

**Step 3: Implement repository**

```typescript
// src/services/repository.ts
import {
  Inspiration,
  Content,
  Article,
  VoiceProfile,
  STORAGE_KEYS,
} from '../types.js';

interface Storage {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
}

export class Repository {
  constructor(private storage: Storage) {}

  // --- Inspirations ---

  private async getInspirations(): Promise<Inspiration[]> {
    const data = await this.storage.get(STORAGE_KEYS.INSPIRATIONS);
    return data ? JSON.parse(data) : [];
  }

  private async setInspirations(inspirations: Inspiration[]): Promise<void> {
    await this.storage.set(STORAGE_KEYS.INSPIRATIONS, JSON.stringify(inspirations));
  }

  async saveInspiration(inspiration: Inspiration): Promise<void> {
    const all = await this.getInspirations();
    const idx = all.findIndex(i => i.id === inspiration.id);
    if (idx >= 0) {
      all[idx] = inspiration;
    } else {
      all.push(inspiration);
    }
    await this.setInspirations(all);
  }

  async getInspiration(id: string): Promise<Inspiration | null> {
    const all = await this.getInspirations();
    return all.find(i => i.id === id) ?? null;
  }

  async listInspirations(): Promise<Inspiration[]> {
    return this.getInspirations();
  }

  async listFeedInspirations(): Promise<Inspiration[]> {
    const all = await this.getInspirations();
    return all.filter(i => i.type === 'feed');
  }

  // --- Content ---

  private async getAllContent(): Promise<Content[]> {
    const data = await this.storage.get(STORAGE_KEYS.CONTENT);
    return data ? JSON.parse(data) : [];
  }

  private async setAllContent(content: Content[]): Promise<void> {
    await this.storage.set(STORAGE_KEYS.CONTENT, JSON.stringify(content));
  }

  async saveContent(content: Content): Promise<void> {
    const all = await this.getAllContent();
    const idx = all.findIndex(c => c.id === content.id);
    if (idx >= 0) {
      all[idx] = content;
    } else {
      all.push(content);
    }
    await this.setAllContent(all);
  }

  async getContent(id: string): Promise<Content | null> {
    const all = await this.getAllContent();
    return all.find(c => c.id === id) ?? null;
  }

  async getContentByUrl(url: string): Promise<Content | null> {
    const all = await this.getAllContent();
    return all.find(c => c.url === url) ?? null;
  }

  async searchContent(query: string, limit = 10): Promise<Content[]> {
    const all = await this.getAllContent();
    const q = query.toLowerCase();
    return all
      .filter(c => !c.isVoiceSample)
      .filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.content.toLowerCase().includes(q) ||
        c.tags.some(t => t.toLowerCase().includes(q))
      )
      .slice(0, limit);
  }

  async listContent(opts: { tags?: string[]; limit?: number; offset?: number } = {}): Promise<Content[]> {
    const { tags, limit = 20, offset = 0 } = opts;
    let all = await this.getAllContent();
    all = all.filter(c => !c.isVoiceSample);

    if (tags && tags.length > 0) {
      all = all.filter(c => tags.some(t => c.tags.includes(t)));
    }

    return all.slice(offset, offset + limit);
  }

  async countContent(): Promise<number> {
    const all = await this.getAllContent();
    return all.filter(c => !c.isVoiceSample).length;
  }

  async getVoiceSamples(): Promise<Content[]> {
    const all = await this.getAllContent();
    return all.filter(c => c.isVoiceSample);
  }

  async getContentByIds(ids: string[]): Promise<Content[]> {
    const all = await this.getAllContent();
    return all.filter(c => ids.includes(c.id));
  }

  // --- Articles ---

  private async getAllArticles(): Promise<Article[]> {
    const data = await this.storage.get(STORAGE_KEYS.ARTICLES);
    return data ? JSON.parse(data) : [];
  }

  private async setAllArticles(articles: Article[]): Promise<void> {
    await this.storage.set(STORAGE_KEYS.ARTICLES, JSON.stringify(articles));
  }

  async saveArticle(article: Article): Promise<void> {
    const all = await this.getAllArticles();
    const idx = all.findIndex(a => a.id === article.id);
    if (idx >= 0) {
      all[idx] = article;
    } else {
      all.push(article);
    }
    await this.setAllArticles(all);
  }

  async getArticle(id: string): Promise<Article | null> {
    const all = await this.getAllArticles();
    return all.find(a => a.id === id) ?? null;
  }

  async listArticles(opts: { status?: 'draft' | 'published' | 'all'; limit?: number } = {}): Promise<Article[]> {
    const { status = 'all', limit = 20 } = opts;
    let all = await this.getAllArticles();

    if (status !== 'all') {
      all = all.filter(a => a.status === status);
    }

    return all.slice(0, limit);
  }

  // --- Voice Profile ---

  async getVoiceProfile(): Promise<VoiceProfile | null> {
    const data = await this.storage.get(STORAGE_KEYS.VOICE_PROFILE);
    return data ? JSON.parse(data) : null;
  }

  async saveVoiceProfile(profile: VoiceProfile): Promise<void> {
    await this.storage.set(STORAGE_KEYS.VOICE_PROFILE, JSON.stringify(profile));
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/repository.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/services/repository.ts tests/repository.test.ts
git commit -m "feat: add storage repository with CRUD operations"
```

---

## Phase 3: Content Extraction Services

### Task 3.1: Create Content Extractor

**Files:**
- Create: `content-hoarder/src/services/contentExtractor.ts`
- Create: `content-hoarder/tests/contentExtractor.test.ts`

**Step 1: Write failing test**

```typescript
// tests/contentExtractor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ContentExtractor } from '../src/services/contentExtractor.js';

describe('ContentExtractor', () => {
  const extractor = new ContentExtractor();

  it('should extract article content from HTML', async () => {
    const html = `
      <html>
        <head><title>Test Article</title></head>
        <body>
          <article>
            <h1>Test Article Title</h1>
            <p>This is the main content of the article.</p>
            <p>It has multiple paragraphs.</p>
          </article>
        </body>
      </html>
    `;

    const result = await extractor.extractFromHtml(html, 'https://example.com/article');

    expect(result).not.toBeNull();
    expect(result?.title).toContain('Test');
    expect(result?.content).toContain('main content');
  });

  it('should detect if URL is a feed', () => {
    expect(extractor.isFeedUrl('https://example.com/feed.xml')).toBe(true);
    expect(extractor.isFeedUrl('https://example.com/rss')).toBe(true);
    expect(extractor.isFeedUrl('https://example.com/atom.xml')).toBe(true);
    expect(extractor.isFeedUrl('https://example.com/feed')).toBe(true);
    expect(extractor.isFeedUrl('https://example.com/article')).toBe(false);
  });
});
```

**Step 2: Run test to verify failure**

```bash
npx vitest run tests/contentExtractor.test.ts
```

**Step 3: Implement content extractor**

```typescript
// src/services/contentExtractor.ts
import { extract } from '@extractus/article-extractor';

export interface ExtractedContent {
  title: string;
  content: string;
  author?: string;
  publishedAt?: number;
}

export class ContentExtractor {
  async extractFromUrl(url: string): Promise<ExtractedContent | null> {
    try {
      const article = await extract(url);
      if (!article || !article.content) return null;

      return {
        title: article.title || 'Untitled',
        content: this.cleanContent(article.content),
        author: article.author || undefined,
        publishedAt: article.published ? new Date(article.published).getTime() : undefined,
      };
    } catch (error) {
      console.error('[ContentExtractor] Extract error:', error);
      return null;
    }
  }

  async extractFromHtml(html: string, url: string): Promise<ExtractedContent | null> {
    try {
      const article = await extract(url, html);
      if (!article || !article.content) return null;

      return {
        title: article.title || 'Untitled',
        content: this.cleanContent(article.content),
        author: article.author || undefined,
        publishedAt: article.published ? new Date(article.published).getTime() : undefined,
      };
    } catch (error) {
      console.error('[ContentExtractor] Extract from HTML error:', error);
      return null;
    }
  }

  isFeedUrl(url: string): boolean {
    const u = url.toLowerCase();
    return (
      u.includes('/feed') ||
      u.includes('/rss') ||
      u.includes('/atom') ||
      u.endsWith('.xml') ||
      u.endsWith('.rss')
    );
  }

  async detectFeed(url: string): Promise<boolean> {
    if (this.isFeedUrl(url)) return true;

    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      });
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      return (
        contentType.includes('xml') ||
        contentType.includes('rss') ||
        contentType.includes('atom') ||
        text.trimStart().startsWith('<?xml') ||
        text.includes('<rss') ||
        text.includes('<feed')
      );
    } catch {
      return false;
    }
  }

  private cleanContent(html: string): string {
    // Remove HTML tags and clean up whitespace
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
```

**Step 4: Run tests**

```bash
npx vitest run tests/contentExtractor.test.ts
```

**Step 5: Commit**

```bash
git add src/services/contentExtractor.ts tests/contentExtractor.test.ts
git commit -m "feat: add content extractor service"
```

---

### Task 3.2: Create Feed Parser

**Files:**
- Create: `content-hoarder/src/services/feedParser.ts`
- Create: `content-hoarder/tests/feedParser.test.ts`

**Step 1: Write failing test**

```typescript
// tests/feedParser.test.ts
import { describe, it, expect } from 'vitest';
import { FeedParser } from '../src/services/feedParser.js';

describe('FeedParser', () => {
  const parser = new FeedParser();

  it('should parse RSS feed XML', async () => {
    const rss = `
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Test Feed</title>
          <item>
            <title>Article 1</title>
            <link>https://example.com/article1</link>
            <description>Description 1</description>
          </item>
          <item>
            <title>Article 2</title>
            <link>https://example.com/article2</link>
            <description>Description 2</description>
          </item>
        </channel>
      </rss>
    `;

    const result = await parser.parseFromXml(rss);

    expect(result.title).toBe('Test Feed');
    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe('Article 1');
    expect(result.items[0].link).toBe('https://example.com/article1');
  });
});
```

**Step 2: Run test to verify failure**

```bash
npx vitest run tests/feedParser.test.ts
```

**Step 3: Implement feed parser**

```typescript
// src/services/feedParser.ts
import Parser from 'rss-parser';

export interface FeedItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  author?: string;
}

export interface ParsedFeed {
  title: string;
  items: FeedItem[];
}

export class FeedParser {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
  }

  async parseFromUrl(url: string): Promise<ParsedFeed> {
    const feed = await this.parser.parseURL(url);
    return this.mapFeed(feed);
  }

  async parseFromXml(xml: string): Promise<ParsedFeed> {
    const feed = await this.parser.parseString(xml);
    return this.mapFeed(feed);
  }

  private mapFeed(feed: Parser.Output<Record<string, unknown>>): ParsedFeed {
    return {
      title: feed.title || 'Untitled Feed',
      items: (feed.items || []).map(item => ({
        title: item.title || 'Untitled',
        link: item.link || '',
        description: item.contentSnippet || item.content || undefined,
        pubDate: item.pubDate || item.isoDate || undefined,
        author: item.creator || item.author || undefined,
      })),
    };
  }
}
```

**Step 4: Run tests**

```bash
npx vitest run tests/feedParser.test.ts
```

**Step 5: Commit**

```bash
git add src/services/feedParser.ts tests/feedParser.test.ts
git commit -m "feat: add feed parser service"
```

---

## Phase 4: LLM Services

### Task 4.1: Create LLM Client

**Files:**
- Create: `content-hoarder/src/services/llm.ts`

**Step 1: Create LLM client**

```typescript
// src/services/llm.ts
import Anthropic from '@anthropic-ai/sdk';

export interface LLMConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
}

export interface LLMClient {
  complete(prompt: string, maxTokens?: number): Promise<string>;
}

export function detectProvider(config: Record<string, string>): LLMConfig | null {
  if (config.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', apiKey: config.ANTHROPIC_API_KEY };
  }
  if (config.OPENAI_API_KEY) {
    return { provider: 'openai', apiKey: config.OPENAI_API_KEY };
  }
  return null;
}

export function createLLMClient(config: LLMConfig): LLMClient {
  if (config.provider === 'anthropic') {
    return new AnthropicClient(config.apiKey);
  }
  throw new Error(`Unsupported provider: ${config.provider}`);
}

class AnthropicClient implements LLMClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(prompt: string, maxTokens = 4096): Promise<string> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    if (block.type === 'text') {
      return block.text;
    }
    return '';
  }
}
```

**Step 2: Commit**

```bash
git add src/services/llm.ts
git commit -m "feat: add LLM client abstraction"
```

---

### Task 4.2: Create Auto-Tagger

**Files:**
- Create: `content-hoarder/src/services/tagger.ts`

**Step 1: Create tagger service**

```typescript
// src/services/tagger.ts
import type { LLMClient } from './llm.js';

export class Tagger {
  constructor(private llm: LLMClient) {}

  async generateTags(title: string, content: string): Promise<string[]> {
    const preview = content.slice(0, 1000);

    const prompt = `Given this article:
Title: ${title}
Content: ${preview}...

Generate 3-5 descriptive tags as a JSON array.
Tags should be lowercase, single words or short phrases (max 2 words).
Focus on topics, themes, and key concepts.

Reply with ONLY the JSON array, no other text. Example: ["ai", "machine learning", "ethics"]`;

    try {
      const response = await this.llm.complete(prompt, 200);
      const tags = JSON.parse(response.trim());

      if (Array.isArray(tags)) {
        return tags
          .filter((t): t is string => typeof t === 'string')
          .map(t => t.toLowerCase().trim())
          .slice(0, 5);
      }
    } catch (error) {
      console.error('[Tagger] Error generating tags:', error);
    }

    return [];
  }
}
```

**Step 2: Commit**

```bash
git add src/services/tagger.ts
git commit -m "feat: add auto-tagger service"
```

---

### Task 4.3: Create Voice Profile Generator

**Files:**
- Create: `content-hoarder/src/services/voiceProfileGenerator.ts`

**Step 1: Create voice profile generator**

```typescript
// src/services/voiceProfileGenerator.ts
import type { LLMClient } from './llm.js';
import type { Content, VoiceProfile } from '../types.js';

export class VoiceProfileGenerator {
  constructor(private llm: LLMClient) {}

  async generate(samples: Content[]): Promise<VoiceProfile> {
    if (samples.length === 0) {
      return {
        analysis: '',
        sampleCount: 0,
        lastUpdatedAt: Date.now(),
      };
    }

    const samplesText = samples
      .slice(0, 10) // Limit to 10 samples
      .map((s, i) => `--- Sample ${i + 1}: "${s.title}" ---\n${s.content.slice(0, 2000)}`)
      .join('\n\n');

    const prompt = `Analyze these writing samples and create a detailed style guide:

${samplesText}

Create a comprehensive style guide covering:
1. Overall tone and voice (formal/casual, technical/accessible, etc.)
2. Sentence structure preferences (short/long, simple/complex)
3. Vocabulary and word choice patterns
4. How ideas are introduced and concluded
5. Use of examples, analogies, or humor
6. Paragraph structure and flow
7. Any distinctive stylistic patterns or quirks

Write the style guide as clear, actionable guidance that could be used to write new content in this voice.`;

    try {
      const analysis = await this.llm.complete(prompt, 2000);
      return {
        analysis: analysis.trim(),
        sampleCount: samples.length,
        lastUpdatedAt: Date.now(),
      };
    } catch (error) {
      console.error('[VoiceProfileGenerator] Error:', error);
      return {
        analysis: '',
        sampleCount: samples.length,
        lastUpdatedAt: Date.now(),
      };
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/services/voiceProfileGenerator.ts
git commit -m "feat: add voice profile generator"
```

---

### Task 4.4: Create Article Generator

**Files:**
- Create: `content-hoarder/src/services/articleGenerator.ts`

**Step 1: Create article generator**

```typescript
// src/services/articleGenerator.ts
import type { LLMClient } from './llm.js';
import type { Content, VoiceProfile, Article } from '../types.js';
import { v4 as uuid } from 'uuid';

export class ArticleGenerator {
  constructor(private llm: LLMClient) {}

  async generate(
    sourceContent: Content[],
    voiceProfile: VoiceProfile,
    instructions: string
  ): Promise<Article> {
    const sourcesText = sourceContent
      .map((c, i) => `--- Source ${i + 1}: "${c.title}" ---\n${c.content.slice(0, 3000)}`)
      .join('\n\n');

    const prompt = `You are writing an article based on the following source material and instructions.

## Voice/Style Guide
${voiceProfile.analysis || 'Write in a clear, engaging style.'}

## Source Material
${sourcesText}

## Instructions
${instructions}

## Task
Write a well-structured article in Markdown format based on the source material and instructions.
Follow the voice/style guide closely.
Include a title as an H1 heading at the start.
Be original - synthesize and transform the source material, don't just summarize.`;

    const content = await this.llm.complete(prompt, 4000);
    const title = this.extractTitle(content);

    return {
      id: uuid(),
      title,
      content: content.trim(),
      status: 'draft',
      sourceContentIds: sourceContent.map(c => c.id),
      instructions,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  async revise(article: Article, feedback: string, voiceProfile: VoiceProfile): Promise<Article> {
    const prompt = `You are revising an article based on feedback.

## Voice/Style Guide
${voiceProfile.analysis || 'Write in a clear, engaging style.'}

## Current Article
${article.content}

## Feedback
${feedback}

## Task
Revise the article according to the feedback.
Maintain the voice/style guide.
Return the complete revised article in Markdown format.`;

    const content = await this.llm.complete(prompt, 4000);
    const title = this.extractTitle(content);

    return {
      ...article,
      title: title || article.title,
      content: content.trim(),
      updatedAt: Date.now(),
    };
  }

  private extractTitle(content: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : 'Untitled';
  }
}
```

**Step 2: Commit**

```bash
git add src/services/articleGenerator.ts
git commit -m "feat: add article generator service"
```

---

## Phase 5: Action Handlers

### Task 5.1: Create Action Handler Structure

**Files:**
- Create: `content-hoarder/src/actions/index.ts`
- Create: `content-hoarder/src/actions/addVoiceSample.ts`

**Step 1: Create addVoiceSample action**

```typescript
// src/actions/addVoiceSample.ts
import { v4 as uuid } from 'uuid';
import { Repository } from '../services/repository.js';
import { ContentExtractor } from '../services/contentExtractor.js';
import { Tagger } from '../services/tagger.js';
import { VoiceProfileGenerator } from '../services/voiceProfileGenerator.js';
import type { LLMClient } from '../services/llm.js';
import type { AddVoiceSampleInput, ActionResponse, Content } from '../types.js';

export async function addVoiceSample(
  input: AddVoiceSampleInput,
  repo: Repository,
  llm: LLMClient
): Promise<ActionResponse> {
  const extractor = new ContentExtractor();
  const tagger = new Tagger(llm);
  const voiceGen = new VoiceProfileGenerator(llm);

  // Check if already exists
  const existing = await repo.getContentByUrl(input.url);
  if (existing?.isVoiceSample) {
    const samples = await repo.getVoiceSamples();
    return {
      responseMode: 'template',
      agentData: {
        template: 'success',
        title: existing.title,
        sampleCount: samples.length,
      },
    };
  }

  // Extract content
  const extracted = await extractor.extractFromUrl(input.url);
  if (!extracted) {
    return {
      responseMode: 'template',
      agentData: { template: 'extraction_error' },
    };
  }

  // Generate tags
  const tags = await tagger.generateTags(extracted.title, extracted.content);

  // Save as voice sample
  const content: Content = {
    id: uuid(),
    inspirationId: 'voice-sample',
    url: input.url,
    title: extracted.title,
    content: extracted.content,
    author: extracted.author,
    publishedAt: extracted.publishedAt,
    tags,
    isVoiceSample: true,
    createdAt: Date.now(),
  };
  await repo.saveContent(content);

  // Regenerate voice profile
  const samples = await repo.getVoiceSamples();
  const profile = await voiceGen.generate(samples);
  await repo.saveVoiceProfile(profile);

  return {
    responseMode: 'template',
    agentData: {
      template: 'success',
      title: content.title,
      sampleCount: samples.length,
    },
  };
}
```

**Step 2: Create actions index**

```typescript
// src/actions/index.ts
export { addVoiceSample } from './addVoiceSample.js';
export { addInspiration } from './addInspiration.js';
export { syncFeeds } from './syncFeeds.js';
export { search } from './search.js';
export { listContent } from './listContent.js';
export { create } from './create.js';
export { revise } from './revise.js';
export { publish } from './publish.js';
export { listArticles } from './listArticles.js';
```

**Step 3: Commit**

```bash
git add src/actions/addVoiceSample.ts src/actions/index.ts
git commit -m "feat: add addVoiceSample action"
```

---

### Task 5.2: Create addInspiration Action

**Files:**
- Create: `content-hoarder/src/actions/addInspiration.ts`

**Step 1: Create action**

```typescript
// src/actions/addInspiration.ts
import { v4 as uuid } from 'uuid';
import { Repository } from '../services/repository.js';
import { ContentExtractor } from '../services/contentExtractor.js';
import { FeedParser } from '../services/feedParser.js';
import { Tagger } from '../services/tagger.js';
import type { LLMClient } from '../services/llm.js';
import type { AddInspirationInput, ActionResponse, Inspiration, Content } from '../types.js';

export async function addInspiration(
  input: AddInspirationInput,
  repo: Repository,
  llm: LLMClient
): Promise<ActionResponse> {
  const extractor = new ContentExtractor();
  const feedParser = new FeedParser();
  const tagger = new Tagger(llm);

  const isFeed = await extractor.detectFeed(input.url);

  if (isFeed) {
    return handleFeed(input.url, repo, extractor, feedParser, tagger);
  } else {
    return handleSingle(input.url, repo, extractor, tagger);
  }
}

async function handleFeed(
  url: string,
  repo: Repository,
  extractor: ContentExtractor,
  feedParser: FeedParser,
  tagger: Tagger
): Promise<ActionResponse> {
  try {
    const feed = await feedParser.parseFromUrl(url);

    const inspiration: Inspiration = {
      id: uuid(),
      url,
      type: 'feed',
      title: feed.title,
      lastFetchedAt: Date.now(),
      createdAt: Date.now(),
    };
    await repo.saveInspiration(inspiration);

    let addedCount = 0;
    for (const item of feed.items) {
      if (!item.link) continue;

      const existing = await repo.getContentByUrl(item.link);
      if (existing) continue;

      const extracted = await extractor.extractFromUrl(item.link);
      if (!extracted) continue;

      const tags = await tagger.generateTags(extracted.title, extracted.content);

      const content: Content = {
        id: uuid(),
        inspirationId: inspiration.id,
        url: item.link,
        title: extracted.title,
        content: extracted.content,
        author: extracted.author || item.author,
        publishedAt: extracted.publishedAt,
        tags,
        isVoiceSample: false,
        createdAt: Date.now(),
      };
      await repo.saveContent(content);
      addedCount++;
    }

    return {
      responseMode: 'template',
      agentData: {
        template: 'feed_added',
        type: 'feed',
        title: feed.title,
        count: addedCount,
      },
    };
  } catch (error) {
    console.error('[addInspiration] Feed error:', error);
    return {
      responseMode: 'template',
      agentData: { template: 'fetch_error' },
    };
  }
}

async function handleSingle(
  url: string,
  repo: Repository,
  extractor: ContentExtractor,
  tagger: Tagger
): Promise<ActionResponse> {
  try {
    const existing = await repo.getContentByUrl(url);
    if (existing) {
      return {
        responseMode: 'template',
        agentData: {
          template: 'content_added',
          type: 'single',
          title: existing.title,
          count: 1,
        },
      };
    }

    const extracted = await extractor.extractFromUrl(url);
    if (!extracted) {
      return {
        responseMode: 'template',
        agentData: { template: 'extraction_error' },
      };
    }

    const inspiration: Inspiration = {
      id: uuid(),
      url,
      type: 'single',
      title: extracted.title,
      lastFetchedAt: Date.now(),
      createdAt: Date.now(),
    };
    await repo.saveInspiration(inspiration);

    const tags = await tagger.generateTags(extracted.title, extracted.content);

    const content: Content = {
      id: uuid(),
      inspirationId: inspiration.id,
      url,
      title: extracted.title,
      content: extracted.content,
      author: extracted.author,
      publishedAt: extracted.publishedAt,
      tags,
      isVoiceSample: false,
      createdAt: Date.now(),
    };
    await repo.saveContent(content);

    return {
      responseMode: 'template',
      agentData: {
        template: 'content_added',
        type: 'single',
        title: content.title,
        count: 1,
      },
    };
  } catch (error) {
    console.error('[addInspiration] Single error:', error);
    return {
      responseMode: 'template',
      agentData: { template: 'fetch_error' },
    };
  }
}
```

**Step 2: Commit**

```bash
git add src/actions/addInspiration.ts
git commit -m "feat: add addInspiration action with feed detection"
```

---

### Task 5.3: Create Remaining Actions

**Files:**
- Create: `content-hoarder/src/actions/syncFeeds.ts`
- Create: `content-hoarder/src/actions/search.ts`
- Create: `content-hoarder/src/actions/listContent.ts`
- Create: `content-hoarder/src/actions/create.ts`
- Create: `content-hoarder/src/actions/revise.ts`
- Create: `content-hoarder/src/actions/publish.ts`
- Create: `content-hoarder/src/actions/listArticles.ts`

**Step 1: Create syncFeeds**

```typescript
// src/actions/syncFeeds.ts
import { v4 as uuid } from 'uuid';
import { Repository } from '../services/repository.js';
import { ContentExtractor } from '../services/contentExtractor.js';
import { FeedParser } from '../services/feedParser.js';
import { Tagger } from '../services/tagger.js';
import type { LLMClient } from '../services/llm.js';
import type { ActionResponse, Content } from '../types.js';

export async function syncFeeds(
  repo: Repository,
  llm: LLMClient
): Promise<ActionResponse> {
  const feeds = await repo.listFeedInspirations();

  if (feeds.length === 0) {
    return {
      responseMode: 'template',
      agentData: { template: 'no_feeds' },
    };
  }

  const extractor = new ContentExtractor();
  const feedParser = new FeedParser();
  const tagger = new Tagger(llm);

  let newContentCount = 0;

  for (const inspiration of feeds) {
    try {
      const feed = await feedParser.parseFromUrl(inspiration.url);

      for (const item of feed.items) {
        if (!item.link) continue;

        const existing = await repo.getContentByUrl(item.link);
        if (existing) continue;

        const extracted = await extractor.extractFromUrl(item.link);
        if (!extracted) continue;

        const tags = await tagger.generateTags(extracted.title, extracted.content);

        const content: Content = {
          id: uuid(),
          inspirationId: inspiration.id,
          url: item.link,
          title: extracted.title,
          content: extracted.content,
          author: extracted.author || item.author,
          publishedAt: extracted.publishedAt,
          tags,
          isVoiceSample: false,
          createdAt: Date.now(),
        };
        await repo.saveContent(content);
        newContentCount++;
      }

      // Update lastFetchedAt
      inspiration.lastFetchedAt = Date.now();
      await repo.saveInspiration(inspiration);
    } catch (error) {
      console.error(`[syncFeeds] Error syncing ${inspiration.url}:`, error);
    }
  }

  return {
    responseMode: 'template',
    agentData: {
      template: 'synced',
      feedCount: feeds.length,
      newContentCount,
    },
  };
}
```

**Step 2: Create search**

```typescript
// src/actions/search.ts
import { Repository } from '../services/repository.js';
import type { SearchInput, ActionResponse, SessionState } from '../types.js';

export async function search(
  input: SearchInput,
  repo: Repository,
  session: SessionState
): Promise<{ response: ActionResponse; sessionUpdate: Partial<SessionState> }> {
  const limit = input.limit ?? 10;
  const results = await repo.searchContent(input.query, limit);

  // Filter by tags if provided
  let filtered = results;
  if (input.tags && input.tags.length > 0) {
    filtered = results.filter(c => input.tags!.some(t => c.tags.includes(t)));
  }

  const contentIds = filtered.map(c => c.id);

  if (contentIds.length === 0) {
    return {
      response: {
        responseMode: 'template',
        agentData: { template: 'empty', count: 0, contentIds: [] },
      },
      sessionUpdate: { currentSearchResults: [] },
    };
  }

  return {
    response: {
      responseMode: 'template',
      agentData: {
        template: 'found',
        count: contentIds.length,
        contentIds,
      },
    },
    sessionUpdate: { currentSearchResults: contentIds },
  };
}
```

**Step 3: Create listContent**

```typescript
// src/actions/listContent.ts
import { Repository } from '../services/repository.js';
import type { ListContentInput, ActionResponse } from '../types.js';

export async function listContent(
  input: ListContentInput,
  repo: Repository
): Promise<ActionResponse> {
  const content = await repo.listContent({
    tags: input.tags,
    limit: input.limit,
    offset: input.offset,
  });

  if (content.length === 0) {
    return {
      responseMode: 'template',
      agentData: { template: 'empty' },
    };
  }

  const total = await repo.countContent();

  const formatted = content
    .map((c, i) => {
      const tags = c.tags.length > 0 ? ` [${c.tags.join(', ')}]` : '';
      return `${i + 1}. **${c.title}**${tags}\n   ${c.content.slice(0, 150)}...`;
    })
    .join('\n\n');

  return {
    responseMode: 'passthrough',
    userContent: {
      contentType: 'content-list',
      content: formatted,
      metadata: {
        count: content.length,
        total,
      },
    },
  };
}
```

**Step 4: Create create**

```typescript
// src/actions/create.ts
import { Repository } from '../services/repository.js';
import { ArticleGenerator } from '../services/articleGenerator.js';
import type { LLMClient } from '../services/llm.js';
import type { CreateInput, ActionResponse, SessionState } from '../types.js';

export async function create(
  input: CreateInput,
  repo: Repository,
  llm: LLMClient,
  session: SessionState
): Promise<{ response: ActionResponse; sessionUpdate: Partial<SessionState> }> {
  // Get content IDs from input or session
  const contentIds = input.contentIds ?? session.currentSearchResults ?? [];

  if (contentIds.length === 0) {
    return {
      response: {
        responseMode: 'template',
        agentData: { template: 'no_content' },
      },
      sessionUpdate: {},
    };
  }

  // Get voice profile
  const voiceProfile = await repo.getVoiceProfile();
  if (!voiceProfile || !voiceProfile.analysis) {
    return {
      response: {
        responseMode: 'template',
        agentData: { template: 'no_voice' },
      },
      sessionUpdate: {},
    };
  }

  // Get content
  const sourceContent = await repo.getContentByIds(contentIds);
  if (sourceContent.length === 0) {
    return {
      response: {
        responseMode: 'template',
        agentData: { template: 'no_content' },
      },
      sessionUpdate: {},
    };
  }

  // Generate article
  const generator = new ArticleGenerator(llm);
  const article = await generator.generate(sourceContent, voiceProfile, input.instructions);

  // Save draft
  await repo.saveArticle(article);

  return {
    response: {
      responseMode: 'passthrough',
      userContent: {
        contentType: 'article',
        content: article.content,
        metadata: {
          articleId: article.id,
          title: article.title,
        },
      },
    },
    sessionUpdate: { currentArticleId: article.id },
  };
}
```

**Step 5: Create revise**

```typescript
// src/actions/revise.ts
import { Repository } from '../services/repository.js';
import { ArticleGenerator } from '../services/articleGenerator.js';
import type { LLMClient } from '../services/llm.js';
import type { ReviseInput, ActionResponse, SessionState } from '../types.js';

export async function revise(
  input: ReviseInput,
  repo: Repository,
  llm: LLMClient,
  session: SessionState
): Promise<{ response: ActionResponse; sessionUpdate: Partial<SessionState> }> {
  const articleId = input.articleId ?? session.currentArticleId;

  if (!articleId) {
    return {
      response: {
        responseMode: 'template',
        agentData: { template: 'no_article' },
      },
      sessionUpdate: {},
    };
  }

  const article = await repo.getArticle(articleId);
  if (!article) {
    return {
      response: {
        responseMode: 'template',
        agentData: { template: 'not_found' },
      },
      sessionUpdate: {},
    };
  }

  const voiceProfile = await repo.getVoiceProfile();
  if (!voiceProfile) {
    return {
      response: {
        responseMode: 'template',
        agentData: { template: 'error' },
      },
      sessionUpdate: {},
    };
  }

  const generator = new ArticleGenerator(llm);
  const revised = await generator.revise(article, input.feedback, voiceProfile);

  await repo.saveArticle(revised);

  return {
    response: {
      responseMode: 'passthrough',
      userContent: {
        contentType: 'article',
        content: revised.content,
        metadata: {
          articleId: revised.id,
          title: revised.title,
        },
      },
    },
    sessionUpdate: { currentArticleId: revised.id },
  };
}
```

**Step 6: Create publish**

```typescript
// src/actions/publish.ts
import { v4 as uuid } from 'uuid';
import { Repository } from '../services/repository.js';
import { VoiceProfileGenerator } from '../services/voiceProfileGenerator.js';
import type { LLMClient } from '../services/llm.js';
import type { PublishInput, ActionResponse, SessionState, Content } from '../types.js';

export async function publish(
  input: PublishInput,
  repo: Repository,
  llm: LLMClient,
  session: SessionState
): Promise<ActionResponse> {
  const articleId = input.articleId ?? session.currentArticleId;

  if (!articleId) {
    return {
      responseMode: 'template',
      agentData: { template: 'not_found' },
    };
  }

  const article = await repo.getArticle(articleId);
  if (!article) {
    return {
      responseMode: 'template',
      agentData: { template: 'not_found' },
    };
  }

  if (article.status === 'published') {
    return {
      responseMode: 'template',
      agentData: { template: 'already_published' },
    };
  }

  // Mark as published
  article.status = 'published';
  article.publishedAt = Date.now();
  article.updatedAt = Date.now();
  await repo.saveArticle(article);

  // Add article content as voice sample
  const voiceSample: Content = {
    id: uuid(),
    inspirationId: 'published-article',
    url: `article://${article.id}`,
    title: article.title,
    content: article.content,
    tags: [],
    isVoiceSample: true,
    createdAt: Date.now(),
  };
  await repo.saveContent(voiceSample);

  // Regenerate voice profile
  const voiceGen = new VoiceProfileGenerator(llm);
  const samples = await repo.getVoiceSamples();
  const profile = await voiceGen.generate(samples);
  await repo.saveVoiceProfile(profile);

  return {
    responseMode: 'template',
    agentData: {
      template: 'published',
      title: article.title,
      sampleCount: samples.length,
    },
  };
}
```

**Step 7: Create listArticles**

```typescript
// src/actions/listArticles.ts
import { Repository } from '../services/repository.js';
import type { ListArticlesInput, ActionResponse } from '../types.js';

export async function listArticles(
  input: ListArticlesInput,
  repo: Repository
): Promise<ActionResponse> {
  const status = input.status ?? 'all';
  const articles = await repo.listArticles({
    status: status === 'all' ? undefined : status,
    limit: input.limit,
  });

  if (articles.length === 0) {
    return {
      responseMode: 'template',
      agentData: { template: 'empty' },
    };
  }

  const formatted = articles
    .map((a, i) => {
      const statusBadge = a.status === 'published' ? '[Published]' : '[Draft]';
      const date = new Date(a.updatedAt).toLocaleDateString();
      return `${i + 1}. **${a.title}** ${statusBadge}\n   Updated: ${date}`;
    })
    .join('\n\n');

  return {
    responseMode: 'passthrough',
    userContent: {
      contentType: 'article-list',
      content: formatted,
      metadata: {
        count: articles.length,
      },
    },
  };
}
```

**Step 8: Update index.ts**

Update `src/actions/index.ts` with proper exports (already done in Task 5.1).

**Step 9: Commit**

```bash
git add src/actions/*.ts
git commit -m "feat: add all action handlers"
```

---

## Phase 6: Main Entry Point

### Task 6.1: Create graph.ts Entry Point

**Files:**
- Create: `content-hoarder/src/graph.ts`

**Step 1: Create entry point**

```typescript
// src/graph.ts
import { Repository } from './services/repository.js';
import { detectProvider, createLLMClient } from './services/llm.js';
import {
  addVoiceSample,
  addInspiration,
  syncFeeds,
  search,
  listContent,
  create,
  revise,
  publish,
  listArticles,
} from './actions/index.js';
import type { SessionState, ActionResponse } from './types.js';

interface InvokeInput {
  action: string;
  input: Record<string, unknown>;
  session?: {
    history: Array<{
      action: string;
      agentData?: Record<string, unknown>;
      userContent?: Record<string, unknown>;
    }>;
  };
  storage: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
  };
  config: Record<string, string>;
}

async function invoke(ctx: InvokeInput): Promise<ActionResponse> {
  const { action, input, session, storage, config } = ctx;

  // Initialize services
  const repo = new Repository(storage);
  const llmConfig = detectProvider(config);

  if (!llmConfig) {
    console.error('[ContentHoarder] No API key found');
    return {
      responseMode: 'template',
      agentData: { template: 'error' },
    };
  }

  const llm = createLLMClient(llmConfig);

  // Extract session state from history
  const sessionState: SessionState = extractSessionState(session?.history ?? []);

  console.log('[ContentHoarder] invoke:', { action, sessionState });

  try {
    switch (action) {
      case 'addVoiceSample':
        return addVoiceSample(input as any, repo, llm);

      case 'addInspiration':
        return addInspiration(input as any, repo, llm);

      case 'syncFeeds':
        return syncFeeds(repo, llm);

      case 'search': {
        const result = await search(input as any, repo, sessionState);
        // Note: Session update would need to be handled by the gateway
        return result.response;
      }

      case 'listContent':
        return listContent(input as any, repo);

      case 'create': {
        const result = await create(input as any, repo, llm, sessionState);
        return result.response;
      }

      case 'revise': {
        const result = await revise(input as any, repo, llm, sessionState);
        return result.response;
      }

      case 'publish':
        return publish(input as any, repo, llm, sessionState);

      case 'listArticles':
        return listArticles(input as any, repo);

      default:
        return {
          responseMode: 'template',
          agentData: { template: 'error' },
        };
    }
  } catch (error) {
    console.error('[ContentHoarder] Error:', error);
    return {
      responseMode: 'template',
      agentData: { template: 'error' },
    };
  }
}

function extractSessionState(
  history: Array<{ action: string; agentData?: Record<string, unknown>; userContent?: Record<string, unknown> }>
): SessionState {
  const state: SessionState = {};

  for (const entry of history) {
    // Track search results
    if (entry.action === 'search' && entry.agentData?.contentIds) {
      state.currentSearchResults = entry.agentData.contentIds as string[];
    }

    // Track current article
    if ((entry.action === 'create' || entry.action === 'revise') && entry.userContent?.metadata) {
      const metadata = entry.userContent.metadata as Record<string, unknown>;
      if (metadata.articleId) {
        state.currentArticleId = metadata.articleId as string;
      }
    }
  }

  return state;
}

export default { invoke };
```

**Step 2: Build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/graph.ts
git commit -m "feat: add main entry point with action router"
```

---

### Task 6.2: Create vitest.config.ts

**Files:**
- Create: `content-hoarder/vitest.config.ts`

**Step 1: Create vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

**Step 2: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: add vitest config"
```

---

### Task 6.3: Create Integration Test

**Files:**
- Create: `content-hoarder/tests/integration.test.ts`

**Step 1: Create integration test**

```typescript
// tests/integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import graph from '../src/graph.js';

describe('Content Hoarder Integration', () => {
  let mockStorage: Map<string, string>;
  let storage: { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> };

  beforeEach(() => {
    mockStorage = new Map();
    storage = {
      get: async (key: string) => mockStorage.get(key) ?? null,
      set: async (key: string, value: string) => { mockStorage.set(key, value); },
    };
  });

  it('should handle listContent with empty storage', async () => {
    const result = await graph.invoke({
      action: 'listContent',
      input: {},
      storage,
      config: { ANTHROPIC_API_KEY: 'test-key' },
    });

    expect(result.responseMode).toBe('template');
    expect((result as any).agentData.template).toBe('empty');
  });

  it('should handle listArticles with empty storage', async () => {
    const result = await graph.invoke({
      action: 'listArticles',
      input: {},
      storage,
      config: { ANTHROPIC_API_KEY: 'test-key' },
    });

    expect(result.responseMode).toBe('template');
    expect((result as any).agentData.template).toBe('empty');
  });

  it('should handle syncFeeds with no feeds', async () => {
    const result = await graph.invoke({
      action: 'syncFeeds',
      input: {},
      storage,
      config: { ANTHROPIC_API_KEY: 'test-key' },
    });

    expect(result.responseMode).toBe('template');
    expect((result as any).agentData.template).toBe('no_feeds');
  });

  it('should handle create with no content selected', async () => {
    const result = await graph.invoke({
      action: 'create',
      input: { instructions: 'Write something' },
      storage,
      config: { ANTHROPIC_API_KEY: 'test-key' },
    });

    expect(result.responseMode).toBe('template');
    expect((result as any).agentData.template).toBe('no_content');
  });
});
```

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add tests/integration.test.ts
git commit -m "test: add integration tests"
```

---

### Task 6.4: Final Build and Validation

**Step 1: Clean build**

```bash
npm run clean && npm run build
```

**Step 2: Run all tests**

```bash
npm test
```

**Step 3: Verify manifest**

```bash
node -e "const m = require('./manifest.json'); console.log('Actions:', Object.keys(m.actions).join(', '))"
```

**Step 4: Create README**

```markdown
# Content Hoarder Trik

Hoard content from URLs and feeds, build a voice profile from your writing, and generate articles in your style.

## Actions

- **addVoiceSample** - Add your own writing as voice samples
- **addInspiration** - Add URLs (single articles or RSS feeds) to hoard
- **syncFeeds** - Re-fetch feeds for new content
- **search** - Search hoarded content
- **listContent** - List all stored content
- **create** - Generate an article from content + instructions
- **revise** - Edit an article with feedback
- **publish** - Publish article (adds to voice samples)
- **listArticles** - List your articles

## Usage

\`\`\`bash
trik install @molefas/content-hoarder
\`\`\`

## Configuration

Requires one of:
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
```

**Step 5: Final commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Summary

This plan creates a fully functional Content Hoarder trik with:

- **9 actions** covering the complete workflow
- **Session support** for conversational context
- **Persistent storage** for content, articles, and voice profile
- **Feed detection** and auto-parsing
- **Voice profile generation** that improves over time
- **TDD approach** with tests for core components

Total estimated time: 2-3 hours of focused implementation.
