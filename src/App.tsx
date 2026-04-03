import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Image as ImageIcon, 
  BookOpen, 
  History, 
  Printer, 
  Trash2, 
  ChevronRight, 
  Loader2, 
  Plus, 
  RotateCcw, 
  Download,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { cn } from './lib/utils';
import { WrongQuestionRecord, Question, AppTab } from './types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// 辅助组件：安全渲染 SVG
const SvgDisplay = ({ svg, className }: { svg?: string, className?: string }) => {
  if (!svg) return null;
  // 简单的清理，确保是 <svg 开头
  const cleanSvg = svg.trim().startsWith('<svg') ? svg : '';
  if (!cleanSvg) return null;

  return (
    <div 
      className={cn("w-full flex justify-center my-4 bg-white p-4 rounded-xl border border-slate-100", className)}
      dangerouslySetInnerHTML={{ __html: cleanSvg }}
    />
  );
};

// 辅助函数：压缩图片
const compressImage = (base64: string, maxWidth = 1024): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7)); // 压缩质量设为 0.7
    };
  });
};

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('recognition');
  const [records, setRecords] = useState<WrongQuestionRecord[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('wrong_questions');
    if (saved) {
      try {
        setRecords(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved records', e);
      }
    }
  }, []);

  const saveRecord = (record: WrongQuestionRecord) => {
    const updated = [record, ...records];
    setRecords(updated);
    localStorage.setItem('wrong_questions', JSON.stringify(updated));
  };

  const deleteRecord = (id: string) => {
    const updated = records.filter(r => r.id !== id);
    setRecords(updated);
    localStorage.setItem('wrong_questions', JSON.stringify(updated));
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">错题举一反三打印机</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 pb-24">
        {activeTab === 'recognition' ? (
          <RecognitionPage onSave={saveRecord} />
        ) : (
          <WorkbookPage records={records} onDelete={deleteRecord} />
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex justify-around items-center z-10 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        <button
          onClick={() => setActiveTab('recognition')}
          className={cn(
            "flex flex-col items-center gap-1 transition-colors",
            activeTab === 'recognition' ? "text-indigo-600" : "text-slate-400 hover:text-slate-600"
          )}
        >
          <Camera className="w-6 h-6" />
          <span className="text-xs font-medium">拍照识别</span>
        </button>
        <button
          onClick={() => setActiveTab('workbook')}
          className={cn(
            "flex flex-col items-center gap-1 transition-colors",
            activeTab === 'workbook' ? "text-indigo-600" : "text-slate-400 hover:text-slate-600"
          )}
        >
          <History className="w-6 h-6" />
          <span className="text-xs font-medium">错题本</span>
        </button>
      </nav>
    </div>
  );
}

// --- Recognition Page ---

function RecognitionPage({ onSave }: { onSave: (record: WrongQuestionRecord) => void }) {
  const [image, setImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('正在智能识别题目内容...');
  const [step, setStep] = useState<'upload' | 'edit' | 'generate'>('upload');

  const processingMessages = [
    '正在智能识别题目内容...',
    '正在分析几何结构与顶点...',
    '正在提取核心知识点...',
    '即将完成，请稍候...'
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isProcessing) {
      let i = 0;
      interval = setInterval(() => {
        i = (i + 1) % processingMessages.length;
        setProcessingMessage(processingMessages[i]);
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [isProcessing]);
  
  const [originalQuestion, setOriginalQuestion] = useState('');
  const [originalSvg, setOriginalSvg] = useState<string | undefined>(undefined);
  const [knowledgePoint, setKnowledgePoint] = useState('');
  const [similarQuestions, setSimilarQuestions] = useState<Question[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [saved, setSaved] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        setIsProcessing(true);
        const compressedBase64 = await compressImage(base64);
        setImage(compressedBase64);
        processImage(compressedBase64);
      };
      reader.readAsDataURL(file);
    }
  };

  const processImage = async (base64: string) => {
    setIsProcessing(true);
    try {
      const imageData = base64.split(',')[1];
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: `你是一位顶尖的数学几何专家和高级OCR工程师。请精准识别图片中的几何图形及其题目内容。
              
              识别与重构任务：
              1. **深度几何分析**：
                 - 识别图中所有的顶点标注（如 A, B, C, D, E, F 等）。
                 - 建立点与点之间的拓扑连接关系（哪些点构成了线段、多边形、圆等）。
                 - 识别特殊的几何关系：平行、垂直、中点、切线、角平分线等。
              2. **严格过滤非印刷元素**：
                 - 自动识别并彻底忽略图中手写的辅助线、草稿、涂改或任何非原始印刷体的标注。
              3. **高精度 SVG 重构**：
                 - 生成一段标准的 SVG 代码（viewBox='0 0 200 200'）。
                 - 使用黑色线条（stroke="black", stroke-width="1.5"），背景透明（fill="none"）。
                 - **标注对齐**：在每个顶点附近添加 <text> 标签，标注对应的字母。标注位置应根据图形结构智能调整（如在顶点外侧），避免与线段重叠。
                 - **比例协调**：确保生成的 SVG 图形比例与原图视觉效果高度一致。
              
              请以 JSON 格式返回：{ "question": "完整的题目文本", "knowledgePoint": "核心知识点", "originalSvg": "生成的SVG代码" }` },
              { inlineData: { data: imageData, mimeType: "image/jpeg" } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              knowledgePoint: { type: Type.STRING },
              originalSvg: { type: Type.STRING }
            },
            required: ["question", "knowledgePoint", "originalSvg"]
          }
        }
      });

      const result = JSON.parse(response.text || '{}');
      setOriginalQuestion(result.question || '');
      setOriginalSvg(result.originalSvg);
      setKnowledgePoint(result.knowledgePoint || '');
      setStep('edit');
    } catch (error) {
      console.error('OCR Error:', error);
      alert('识别失败，请重试或手动输入');
      setStep('edit');
    } finally {
      setIsProcessing(false);
    }
  };

  const generateSimilar = async () => {
    setIsGenerating(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `基于以下错题及其知识点，生成3道高质量的“举一反三”变式题目。
        原题: ${originalQuestion}
        知识点: ${knowledgePoint}
        
        生成要求：
        1. **变式设计**：覆盖同一知识点的不同应用场景，难度与原题相当或呈阶梯式上升。
        2. **图形重构**：如果题目涉及几何图形，必须为每道题生成一段精确的 SVG 代码（viewBox='0 0 200 200'）。
           - 使用黑色线条（stroke="black", stroke-width="1.5"），背景透明。
           - **必须包含顶点标注**（如 A, B, C 等），且标注位置应合理避开线段。
           - 图形结构必须与题目描述严格匹配。
        3. **完整内容**：每道题需包含题目内容、标准答案、以及侧重易错点分析的深度解析。
        
        请以 JSON 数组格式返回，每个对象包含: 'content', 'answer', 'analysis', 'svg' (涉及图形时必填)。`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                content: { type: Type.STRING },
                answer: { type: Type.STRING },
                analysis: { type: Type.STRING },
                svg: { type: Type.STRING }
              },
              required: ["content", "answer", "analysis"]
            }
          }
        }
      });

      const result = JSON.parse(response.text || '[]');
      setSimilarQuestions(result);
      setStep('generate');
    } catch (error) {
      console.error('Generation Error:', error);
      alert('生成失败，请重试');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = () => {
    const record: WrongQuestionRecord = {
      id: Date.now().toString(),
      originalQuestion,
      originalSvg,
      knowledgePoint,
      similarQuestions,
      createdAt: Date.now()
    };
    onSave(record);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const reset = () => {
    setImage(null);
    setOriginalQuestion('');
    setOriginalSvg(undefined);
    setKnowledgePoint('');
    setSimilarQuestions([]);
    setStep('upload');
    setSaved(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {step === 'upload' && (
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="w-full max-w-md aspect-square bg-white border-2 border-dashed border-slate-300 rounded-3xl flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all group shadow-sm"
          >
            <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
              <Camera className="w-10 h-10 text-indigo-600" />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-slate-700">点击拍照或上传错题</p>
              <p className="text-sm text-slate-400 mt-1">支持 JPG, PNG 格式</p>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              accept="image/*" 
              className="hidden" 
            />
          </div>
          
          {isProcessing && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-slate-500 font-medium">{processingMessage}</p>
            </div>
          )}
        </div>
      )}

      {step === 'edit' && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <span className="w-1.5 h-6 bg-indigo-600 rounded-full"></span>
              确认题目内容
            </h2>
            <button onClick={reset} className="text-slate-400 hover:text-slate-600">
              <RotateCcw className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-600 mb-2">题目文本</label>
              <textarea
                value={originalQuestion}
                onChange={(e) => setOriginalQuestion(e.target.value)}
                className="w-full min-h-[150px] p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all resize-none"
                placeholder="请输入或修改题目内容..."
              />
            </div>
            {originalSvg && (
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-2">识别出的图形</label>
                <SvgDisplay svg={originalSvg} />
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-slate-600 mb-2">核心知识点</label>
              <input
                type="text"
                value={knowledgePoint}
                onChange={(e) => setKnowledgePoint(e.target.value)}
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                placeholder="例如：一元二次方程根的判别式"
              />
            </div>
          </div>

          <button
            onClick={generateSimilar}
            disabled={isGenerating || !originalQuestion}
            className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold text-lg shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:shadow-none transition-all flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                正在生成举一反三题目...
              </>
            ) : (
              <>
                <Plus className="w-5 h-5" />
                生成举一反三题目
              </>
            )}
          </button>
        </div>
      )}

      {step === 'generate' && (
        <div className="space-y-6 pb-12">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xl font-bold text-slate-800">举一反三结果</h2>
            <div className="flex gap-2">
              <button 
                onClick={generateSimilar} 
                disabled={isGenerating}
                className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                title="重新生成"
              >
                <RotateCcw className={cn("w-5 h-5", isGenerating && "animate-spin")} />
              </button>
              <button 
                onClick={reset}
                className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                title="返回上传"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-indigo-700 font-bold mb-2">
              <BookOpen className="w-4 h-4" />
              知识点：{knowledgePoint}
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              为您生成了3道针对该知识点的变式练习，难度与原题相当。
            </p>
          </div>

          <div className="space-y-4">
            {similarQuestions.map((q, idx) => (
              <div key={idx} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded">题目 {idx + 1}</span>
                </div>
                <SvgDisplay svg={q.svg} />
                <div className="prose prose-slate max-w-none">
                  <ReactMarkdown>{q.content}</ReactMarkdown>
                </div>
                <div className="pt-4 border-t border-slate-100 space-y-3">
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-600 font-bold shrink-0">答案：</span>
                    <span className="text-slate-700">{q.answer}</span>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4">
                    <span className="text-indigo-600 font-bold block mb-1">易错点解析：</span>
                    <div className="text-slate-600 text-sm leading-relaxed">
                      <ReactMarkdown>{q.analysis}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleSave}
            disabled={saved}
            className={cn(
              "w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all flex items-center justify-center gap-2",
              saved 
                ? "bg-emerald-500 text-white shadow-emerald-100" 
                : "bg-indigo-600 text-white shadow-indigo-200 hover:bg-indigo-700"
            )}
          >
            {saved ? (
              <>
                <CheckCircle2 className="w-5 h-5" />
                已保存到错题本
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                保存全部到错题本
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// --- Workbook Page ---

function WorkbookPage({ records, onDelete }: { records: WrongQuestionRecord[], onDelete: (id: string) => void }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPrinting, setIsPrinting] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<WrongQuestionRecord | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectAll = () => {
    if (selectedIds.size === records.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(records.map(r => r.id)));
    }
  };

  const handlePrint = async () => {
    if (selectedIds.size === 0) return;
    setIsPrinting(true);
    
    // Small delay to ensure the print container is rendered if we were using a hidden one
    // Here we'll create a temporary hidden div for printing
    const printContainer = document.createElement('div');
    printContainer.style.position = 'absolute';
    printContainer.style.left = '-9999px';
    printContainer.style.width = '800px'; // Standard A4 width approx
    document.body.appendChild(printContainer);

    const selectedRecords = records.filter(r => selectedIds.has(r.id));

    // Render content to printContainer
    printContainer.innerHTML = `
      <div style="padding: 40px; font-family: sans-serif; color: #1e293b;">
        <h1 style="text-align: center; margin-bottom: 40px; color: #4f46e5;">错题举一反三练习册</h1>
        ${selectedRecords.map((record, rIdx) => `
          <div style="margin-bottom: 60px; page-break-inside: avoid;">
            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #4f46e5;">
              <h2 style="margin: 0; font-size: 18px;">记录 ${rIdx + 1}: ${record.knowledgePoint}</h2>
              <p style="margin: 5px 0 0 0; font-size: 12px; color: #64748b;">日期: ${new Date(record.createdAt).toLocaleDateString()}</p>
            </div>
            
            <div style="margin-bottom: 30px;">
              <h3 style="color: #ef4444; font-size: 16px;">【原错题】</h3>
              ${record.originalSvg ? `<div style="width: 100%; display: flex; justify-content: center; margin: 15px 0;">${record.originalSvg}</div>` : ''}
              <div style="line-height: 1.6;">${record.originalQuestion.replace(/\n/g, '<br/>')}</div>
            </div>

            ${record.similarQuestions.map((q, qIdx) => `
              <div style="margin-bottom: 30px; padding-left: 20px; border-left: 2px dashed #e2e8f0;">
                <h3 style="color: #4f46e5; font-size: 15px;">【举一反三 ${qIdx + 1}】</h3>
                ${q.svg ? `<div style="width: 100%; display: flex; justify-content: center; margin: 15px 0;">${q.svg}</div>` : ''}
                <div style="line-height: 1.6; margin-bottom: 15px;">${q.content.replace(/\n/g, '<br/>')}</div>
                <div style="font-size: 14px; margin-bottom: 10px;">
                  <strong style="color: #10b981;">答案：</strong> ${q.answer}
                </div>
                <div style="font-size: 13px; color: #64748b; background: #f1f5f9; padding: 10px; border-radius: 6px;">
                  <strong style="color: #4f46e5;">解析：</strong> ${q.analysis.replace(/\n/g, '<br/>')}
                </div>
              </div>
            `).join('')}
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-top: 40px;"/>
          </div>
        `).join('')}
      </div>
    `;

    try {
      const canvas = await html2canvas(printContainer, {
        scale: 2,
        useCORS: true,
        logging: false
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      let heightLeft = pdfHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pdf.internal.pageSize.getHeight();

      while (heightLeft >= 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pdf.internal.pageSize.getHeight();
      }

      pdf.save(`错题本_${new Date().toLocaleDateString()}.pdf`);
    } catch (error) {
      console.error('PDF Generation Error:', error);
      alert('PDF生成失败');
    } finally {
      document.body.removeChild(printContainer);
      setIsPrinting(false);
    }
  };

  if (viewingRecord) {
    return (
      <div className="space-y-6 animate-in slide-in-from-right duration-300">
        <button 
          onClick={() => setViewingRecord(null)}
          className="flex items-center gap-1 text-slate-500 hover:text-indigo-600 font-medium transition-colors"
        >
          <ChevronRight className="w-5 h-5 rotate-180" />
          返回列表
        </button>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800">{viewingRecord.knowledgePoint}</h2>
            <span className="text-xs text-slate-400">{new Date(viewingRecord.createdAt).toLocaleString()}</span>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl">
              <h3 className="text-red-700 font-bold mb-2 flex items-center gap-2">
                <XCircle className="w-4 h-4" />
                原错题
              </h3>
              <SvgDisplay svg={viewingRecord.originalSvg} />
              <div className="text-slate-700 prose prose-slate max-w-none">
                <ReactMarkdown>{viewingRecord.originalQuestion}</ReactMarkdown>
              </div>
            </div>

            <div className="space-y-4 pt-4">
              <h3 className="text-indigo-700 font-bold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                举一反三练习
              </h3>
              {viewingRecord.similarQuestions.map((q, idx) => (
                <div key={idx} className="bg-slate-50 rounded-xl p-5 border border-slate-100 space-y-3">
                  <div className="font-bold text-slate-800">题目 {idx + 1}</div>
                  <SvgDisplay svg={q.svg} />
                  <div className="prose prose-slate max-w-none text-sm">
                    <ReactMarkdown>{q.content}</ReactMarkdown>
                  </div>
                  <div className="pt-3 border-t border-slate-200 space-y-2">
                    <div className="text-sm"><span className="font-bold text-emerald-600">答案：</span>{q.answer}</div>
                    <div className="text-xs text-slate-500 leading-relaxed">
                      <span className="font-bold text-indigo-600">解析：</span>
                      <ReactMarkdown>{q.analysis}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between sticky top-[73px] bg-slate-50 py-2 z-10">
        <h2 className="text-xl font-bold text-slate-800">历史错题本</h2>
        <div className="flex gap-2">
          {records.length > 0 && (
            <button 
              onClick={selectAll}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              {selectedIds.size === records.length ? '取消全选' : '全选'}
            </button>
          )}
          <button 
            onClick={handlePrint}
            disabled={selectedIds.size === 0 || isPrinting}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-sm font-bold rounded-lg shadow-md shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 disabled:shadow-none transition-all"
          >
            {isPrinting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Printer className="w-4 h-4" />
            )}
            打印所选 ({selectedIds.size})
          </button>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <History className="w-16 h-16 mb-4 opacity-20" />
          <p className="text-lg">暂无错题记录</p>
          <p className="text-sm">快去拍一张错题试试吧</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {records.map((record) => (
            <div 
              key={record.id}
              className={cn(
                "group bg-white rounded-2xl p-4 shadow-sm border transition-all flex items-center gap-4",
                selectedIds.has(record.id) ? "border-indigo-500 ring-1 ring-indigo-500" : "border-slate-200 hover:border-indigo-300"
              )}
            >
              <div 
                onClick={() => toggleSelect(record.id)}
                className={cn(
                  "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 cursor-pointer transition-all",
                  selectedIds.has(record.id) ? "bg-indigo-600 border-indigo-600" : "border-slate-200 group-hover:border-indigo-300"
                )}
              >
                {selectedIds.has(record.id) && <Plus className="w-4 h-4 text-white rotate-45" />}
              </div>

              <div 
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => setViewingRecord(record)}
              >
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-bold text-slate-800 truncate">{record.knowledgePoint}</h3>
                  <span className="text-[10px] text-slate-400 shrink-0">{new Date(record.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-slate-500 line-clamp-1">
                  {record.originalQuestion}
                </p>
              </div>

              <button 
                onClick={() => onDelete(record.id)}
                className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              
              <ChevronRight className="w-5 h-5 text-slate-300" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
