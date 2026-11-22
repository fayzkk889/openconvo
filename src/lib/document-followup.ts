import { DocumentRecord } from '@/types/document';

/**
 * Step 6: Follow-up Document Context Resolution
 * Enables continuous multi-turn questions about uploaded documents without re-uploading,
 * while preventing accidental cross-conversation document leakage.
 */
export function shouldRetrieveConversationDocuments({
  query,
  hasActiveAttachments,
  hasStoredDocuments,
  storedDocuments = [],
}: {
  query: string;
  hasActiveAttachments: boolean;
  hasStoredDocuments: boolean;
  storedDocuments?: DocumentRecord[];
}): boolean {
  // If user attached new files this turn, always retrieve
  if (hasActiveAttachments) {
    return true;
  }

  // If this conversation has no indexed documents at all, nothing to retrieve
  if (!hasStoredDocuments || storedDocuments.length === 0) {
    return false;
  }

  const lower = query.toLowerCase().trim();

  // 1. Explicit filename mention in query
  for (const doc of storedDocuments) {
    const filenameLower = doc.filename.toLowerCase();
    const nameWithoutExt = filenameLower.replace(/\.[a-z0-9]+$/i, '');
    if (lower.includes(filenameLower) || (nameWithoutExt.length >= 4 && lower.includes(nameWithoutExt))) {
      return true;
    }
  }

  // 2. Explicit document cue words
  if (
    /\b(the document|this document|the file|this file|the pdf|the code|the spreadsheet|the csv|the report|the paper|the text|the data|attached|attachment|uploaded|in it|from it|above file|earlier file)\b/i.test(lower) ||
    /\b(what was|how does it compare|what does it say|explain it|summarize it|find in it|show me the part|which section|which page)\b/i.test(lower)
  ) {
    return true;
  }

  // 3. Question words in a document-context conversation (e.g. "What was the revenue in the previous year?")
  if (
    /\b(what|how|why|when|where|who|which|does|did|is|are|can|could|compare|calculate|summarize|explain|find|lookup|show|list)\b/i.test(lower) &&
    !isGeneralUnrelatedQuery(lower)
  ) {
    return true;
  }

  return false;
}

/**
 * Filters out casual or unrelated queries that should not trigger document retrieval.
 */
function isGeneralUnrelatedQuery(lowerQuery: string): boolean {
  return (
    /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|howdy|greetings)[!.]?$/i.test(lowerQuery) ||
    /^(?:tell\s+me\s+a\s+joke|who\s+are\s+you|what\s+can\s+you\s+do|what\s+is\s+your\s+name)[?.]?$/i.test(lowerQuery) ||
    /\b(?:capital of france|distance to moon|speed of light)\b/i.test(lowerQuery)
  );
}
