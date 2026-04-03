export interface Question {
  content: string;
  answer: string;
  analysis: string;
  svg?: string; // SVG code for the figure
}

export interface WrongQuestionRecord {
  id: string;
  originalQuestion: string;
  originalSvg?: string; // SVG code for the original figure
  knowledgePoint: string;
  similarQuestions: Question[];
  createdAt: number;
}

export type AppTab = 'recognition' | 'workbook';
