import React, { useState } from 'react';
import './Sidebar.css';

interface SidebarProps {
  isVisible: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ isVisible }) => {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    pipelines: true,
    environments: true,
    configs: false,
  });

  const [activeFile, setActiveFile] = useState<string>('pipeline-01.json');

  if (!isVisible) return null;

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const PipelineIcon = () => (
    <svg className="file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
  );

  const FolderIcon = () => (
      <svg className="folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
  );

  const ChevronDown = () => (
    <span className="chevron">▼</span>
  );

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>Explorer</span>
        <span>...</span>
      </div>

      <div className="sidebar-section">
        <div 
            className={`sidebar-section-title ${!openSections.pipelines ? 'collapsed' : ''}`}
            onClick={() => toggleSection('pipelines')}
        >
            <ChevronDown />
            <span>PIPELINES</span>
        </div>
        
        {openSections.pipelines && (
            <div className="sidebar-content">
                <div onClick={() => setActiveFile('pipeline-01.json')} className={`file-item ${activeFile === 'pipeline-01.json' ? 'active' : ''}`}>
                    <PipelineIcon />
                    <span>data-processing-v1.json</span>
                </div>
                <div onClick={() => setActiveFile('pipeline-02.json')} className={`file-item ${activeFile === 'pipeline-02.json' ? 'active' : ''}`}>
                    <PipelineIcon />
                    <span>email-outreach-campaign.json</span>
                </div>
                <div onClick={() => setActiveFile('pipeline-03.json')} className={`file-item ${activeFile === 'pipeline-03.json' ? 'active' : ''}`}>
                    <PipelineIcon />
                    <span>analytics-report.json</span>
                </div>
            </div>
        )}
      </div>

      <div className="sidebar-section">
        <div 
            className={`sidebar-section-title ${!openSections.environments ? 'collapsed' : ''}`}
            onClick={() => toggleSection('environments')}
        >
            <ChevronDown />
            <span>ENVIRONMENTS</span>
        </div>
        {openSections.environments && (
            <div className="sidebar-content">
                <div className="folder-item">
                     <FolderIcon />
                     <span>Production</span>
                </div>
                <div className="folder-item">
                     <FolderIcon />
                     <span>Staging</span>
                </div>
                <div className="file-item">
                     <span className="file-icon">⚙️</span>
                     <span>local-dev-env.env</span>
                </div>
            </div>
        )}
      </div>
      
       <div className="sidebar-section">
        <div 
            className={`sidebar-section-title ${!openSections.configs ? 'collapsed' : ''}`}
            onClick={() => toggleSection('configs')}
        >
            <ChevronDown />
            <span>CONFIGS</span>
        </div>
        {openSections.configs && (
             <div className="sidebar-content">
                <div className="file-item">
                     <span className="file-icon">📄</span>
                     <span>global-settings.json</span>
                </div>
             </div>
        )}
      </div>

    </div>
  );
};

export default Sidebar;
