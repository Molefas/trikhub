import type {
  GraphInput,
  GraphResult,
  TrikStorageContext,
} from '@trikhub/manifest';

interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

// Generate a simple ID
function generateId(): string {
  return `note_${Date.now().toString(36)}`;
}

// Main graph object with invoke method (required by TrikGateway)
export default {
  async invoke(input: GraphInput): Promise<GraphResult> {
    const { action, input: actionInput, storage } = input;

    switch (action) {
      case 'add_note':
        return addNote(actionInput as { title: string; content: string }, storage!);
      case 'list_notes':
        return listNotes(storage!);
      case 'get_note':
        return getNote(actionInput as { noteId?: string; titleSearch?: string }, storage!);
      case 'update_note':
        return updateNote(
          actionInput as { noteId?: string; titleSearch?: string; newTitle?: string; newContent?: string },
          storage!
        );
      case 'delete_note':
        return deleteNote(actionInput as { noteId?: string; titleSearch?: string }, storage!);
      default:
        return { agentData: { template: 'error', message: `Unknown action: ${action}` } };
    }
  },
};

async function addNote(
  input: { title: string; content: string },
  storage: TrikStorageContext
): Promise<GraphResult> {
  const noteId = generateId();
  const note: Note = {
    id: noteId,
    title: input.title,
    content: input.content,
    createdAt: new Date().toISOString(),
  };

  // Store the note
  await storage.set(`notes:${noteId}`, note);

  // Update the index
  const indexRaw = await storage.get('notes:index');
  const index = (indexRaw as string[] | null) ?? [];
  index.push(noteId);
  await storage.set('notes:index', index);

  return {
    agentData: {
      template: 'note_added',
      noteId,
      title: input.title,
    },
  };
}

async function listNotes(storage: TrikStorageContext): Promise<GraphResult> {
  const indexRaw = await storage.get('notes:index');
  const index = (indexRaw as string[] | null) ?? [];

  if (index.length === 0) {
    return {
      agentData: {
        template: 'no_notes',
        count: 0,
      },
    };
  }

  // Fetch titles for each note
  const titles: string[] = [];
  for (const noteId of index) {
    const note = (await storage.get(`notes:${noteId}`)) as Note | null;
    if (note) {
      titles.push(note.title);
    }
  }

  return {
    agentData: {
      template: 'notes_list',
      count: index.length,
      noteIds: index,
      titles,
    },
  };
}

async function findNoteByTitle(
  titleSearch: string,
  storage: TrikStorageContext
): Promise<Note | null> {
  const indexRaw = await storage.get('notes:index');
  const index = (indexRaw as string[] | null) ?? [];

  const searchLower = titleSearch.toLowerCase();

  for (const noteId of index) {
    const note = (await storage.get(`notes:${noteId}`)) as Note | null;
    if (note && note.title.toLowerCase().includes(searchLower)) {
      return note;
    }
  }

  return null;
}

async function getNote(
  input: { noteId?: string; titleSearch?: string },
  storage: TrikStorageContext
): Promise<GraphResult> {
  let note: Note | null = null;

  if (input.noteId) {
    note = (await storage.get(`notes:${input.noteId}`)) as Note | null;
  } else if (input.titleSearch) {
    note = await findNoteByTitle(input.titleSearch, storage);
  }

  if (!note) {
    return {
      responseMode: 'template',
      agentData: {
        template: 'note_not_found',
      },
    };
  }

  // Return full note content via passthrough
  return {
    responseMode: 'passthrough',
    userContent: {
      contentType: 'note',
      content: `# ${note.title}\n\n${note.content}\n\n---\nCreated: ${note.createdAt}\nID: ${note.id}`,
      metadata: { noteId: note.id, title: note.title },
    },
  };
}

async function updateNote(
  input: { noteId?: string; titleSearch?: string; newTitle?: string; newContent?: string },
  storage: TrikStorageContext
): Promise<GraphResult> {
  let noteToUpdate: Note | null = null;
  let noteId: string | undefined;

  if (input.noteId) {
    noteId = input.noteId;
    noteToUpdate = (await storage.get(`notes:${noteId}`)) as Note | null;
  } else if (input.titleSearch) {
    noteToUpdate = await findNoteByTitle(input.titleSearch, storage);
    noteId = noteToUpdate?.id;
  }

  if (!noteToUpdate || !noteId) {
    return {
      agentData: {
        template: 'note_not_found',
      },
    };
  }

  // Check if any changes were provided
  if (!input.newTitle && !input.newContent) {
    return {
      agentData: {
        template: 'no_changes',
      },
    };
  }

  // Update the note
  const updatedNote: Note = {
    ...noteToUpdate,
    title: input.newTitle ?? noteToUpdate.title,
    content: input.newContent ?? noteToUpdate.content,
  };
  await storage.set(`notes:${noteId}`, updatedNote);

  return {
    agentData: {
      template: 'note_updated',
      noteId,
      title: updatedNote.title,
    },
  };
}

async function deleteNote(
  input: { noteId?: string; titleSearch?: string },
  storage: TrikStorageContext
): Promise<GraphResult> {
  let noteToDelete: Note | null = null;
  let noteId: string | undefined;

  if (input.noteId) {
    noteId = input.noteId;
    noteToDelete = (await storage.get(`notes:${noteId}`)) as Note | null;
  } else if (input.titleSearch) {
    noteToDelete = await findNoteByTitle(input.titleSearch, storage);
    noteId = noteToDelete?.id;
  }

  if (!noteToDelete || !noteId) {
    return {
      agentData: {
        template: 'note_not_found',
      },
    };
  }

  // Delete the note
  await storage.delete(`notes:${noteId}`);

  // Update the index
  const indexRaw = await storage.get('notes:index');
  const index = (indexRaw as string[] | null) ?? [];
  const newIndex = index.filter((id) => id !== noteId);
  await storage.set('notes:index', newIndex);

  return {
    agentData: {
      template: 'note_deleted',
      noteId,
      title: noteToDelete.title,
    },
  };
}
