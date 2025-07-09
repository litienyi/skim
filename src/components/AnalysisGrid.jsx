import React, { useState, useRef } from 'react';
import './AnalysisGrid.css';

const AnalysisGrid = () => {
  const [data, setData] = useState([]);
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null);
  const [showReferences, setShowReferences] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split('\n').filter(line => line.trim());
      
      const newData = lines.map((line, index) => ({
        id: index + 1,
        text: line.trim(),
        answer: '',
        references: [],
        summary: '',
        status: 'pending'
      }));
      
      setData(newData);
    };
    reader.readAsText(file);
  };

  const analyzeData = async () => {
    if (!question.trim() || data.length === 0) return;
    
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          texts: data.map(item => ({
            id: item.id,
            content: item.text
          })),
          question: question
        })
      });

      if (!response.ok) {
        throw new Error('Analysis failed');
      }

      const result = await response.json();
      
      // Update data with analysis results
      const updatedData = data.map(item => {
        const analysis = result.analyses.find(a => a.text_id === item.id);
        return {
          ...item,
          answer: analysis?.answer || 'No answer available',
          references: analysis?.references || [],
          summary: analysis?.summary || 'No summary available',
          status: analysis ? 'completed' : 'failed'
        };
      });
      
      setData(updatedData);
    } catch (error) {
      console.error('Analysis error:', error);
      // Update status to failed for all items
      setData(prev => prev.map(item => ({ ...item, status: 'failed' })));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCellClick = (rowIndex, column) => {
    const item = data[rowIndex];
    if (column === 'answer' && item.references.length > 0) {
      setSelectedCell({ rowIndex, column, item });
      setShowReferences(true);
    }
  };

  const closeReferences = () => {
    setShowReferences(false);
    setSelectedCell(null);
  };

  const exportToCSV = () => {
    const headers = ['ID', 'Text', 'Answer', 'Summary', 'Status'];
    const csvContent = [
      headers.join(','),
      ...data.map(item => [
        item.id,
        `"${item.text.replace(/"/g, '""')}"`,
        `"${item.answer.replace(/"/g, '""')}"`,
        `"${item.summary.replace(/"/g, '""')}"`,
        item.status
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'analysis_results.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="analysis-grid-container">
      <div className="controls">
        <div className="file-upload">
          <input
            type="file"
            accept=".txt,.csv"
            onChange={handleFileUpload}
            ref={fileInputRef}
            style={{ display: 'none' }}
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="upload-btn"
          >
            📁 Upload Text File
          </button>
          {data.length > 0 && (
            <span className="file-info">
              Loaded {data.length} entries
            </span>
          )}
        </div>

        <div className="question-input">
          <input
            type="text"
            placeholder="Enter your analysis question..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="question-field"
          />
          <button 
            onClick={analyzeData}
            disabled={!question.trim() || data.length === 0 || isLoading}
            className="analyze-btn"
          >
            {isLoading ? '🔄 Analyzing...' : '🔍 Analyze'}
          </button>
        </div>

        {data.length > 0 && (
          <button onClick={exportToCSV} className="export-btn">
            📊 Export to CSV
          </button>
        )}
      </div>

      {data.length > 0 && (
        <div className="grid-container">
          <div className="grid-header">
            <div className="header-cell">ID</div>
            <div className="header-cell">Text</div>
            <div className="header-cell">Answer</div>
            <div className="header-cell">Summary</div>
            <div className="header-cell">Status</div>
          </div>
          
          <div className="grid-body">
            {data.map((item, index) => (
              <div key={item.id} className="grid-row">
                <div className="cell id-cell">{item.id}</div>
                <div className="cell text-cell">{item.text}</div>
                <div 
                  className={`cell answer-cell ${item.references.length > 0 ? 'clickable' : ''}`}
                  onClick={() => handleCellClick(index, 'answer')}
                  title={item.references.length > 0 ? 'Click to view references' : ''}
                >
                  {item.answer || '-'}
                </div>
                <div className="cell summary-cell">{item.summary || '-'}</div>
                <div className={`cell status-cell status-${item.status}`}>
                  {item.status === 'pending' && '⏳'}
                  {item.status === 'completed' && '✅'}
                  {item.status === 'failed' && '❌'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showReferences && selectedCell && (
        <div className="modal-overlay" onClick={closeReferences}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>References for Text #{selectedCell.item.id}</h3>
              <button onClick={closeReferences} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="answer-section">
                <h4>Answer:</h4>
                <p>{selectedCell.item.answer}</p>
              </div>
              <div className="references-section">
                <h4>References ({selectedCell.item.references.length}):</h4>
                {selectedCell.item.references.map((ref, index) => (
                  <div key={index} className="reference-item">
                    <div className="reference-quote">
                      <strong>Quote {index + 1}:</strong> "{ref.quote}"
                    </div>
                    <div className="reference-details">
                      <span><strong>Source:</strong> {ref.source}</span>
                      <span><strong>Context:</strong> {ref.context}</span>
                      <span><strong>Relevance:</strong> {ref.relevance}/100</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="summary-section">
                <h4>Summary:</h4>
                <p>{selectedCell.item.summary}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalysisGrid; 