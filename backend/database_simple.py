"""
Simplified Database for SKIM2 - No Authentication
Simple SQLite database for local document storage and chat sessions.
"""

import os
import logging
from sqlalchemy import (
    create_engine, Column, Integer, String, Float, DateTime, Text, JSON, ForeignKey
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from datetime import datetime

logger = logging.getLogger(__name__)

Base = declarative_base()
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'skim2_local.db')
engine = create_engine(f'sqlite:///{DB_PATH}', echo=False, future=True, connect_args={'timeout': 30, 'check_same_thread': False})
SessionLocal = sessionmaker(bind=engine)

class Document(Base):
    __tablename__ = 'documents'
    file_path = Column(String, primary_key=True)  # Full file path as primary key
    filename = Column(String, nullable=False)  # Display name (original filename)
    text_content = Column(Text, nullable=True)
    pages_data = Column(JSON, nullable=True)  # Store pages as JSON
    num_pages = Column(Integer, nullable=False)
    file_size = Column(Integer, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationship to chat sessions
    chat_sessions = relationship('ChatSession', back_populates='document', cascade='all, delete-orphan')

class ChatSession(Base):
    __tablename__ = 'chat_sessions'
    id = Column(String, primary_key=True)  # UUID string
    document_file_path = Column(String, ForeignKey('documents.file_path'), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationship to document and messages
    document = relationship('Document', back_populates='chat_sessions')
    messages = relationship('ChatMessage', back_populates='chat_session', cascade='all, delete-orphan')

class ChatMessage(Base):
    __tablename__ = 'chat_messages'
    id = Column(String, primary_key=True)  # UUID string
    chat_session_id = Column(String, ForeignKey('chat_sessions.id'), nullable=False)
    role = Column(String, nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    page_range = Column(JSON, nullable=True)  # Store page range as JSON
    references = Column(JSON, nullable=True)  # Store references as JSON
    
    # Relationship to chat session
    chat_session = relationship('ChatSession', back_populates='messages')

def init_db():
    """Initialize the database by creating all tables."""
    try:
        Base.metadata.create_all(engine)
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Error initializing database: {e}")
        raise

def get_db_session():
    """Get a database session."""
    return SessionLocal()

def close_db_session(session):
    """Close a database session."""
    if session:
        session.close()

# Database utility functions
def save_document(doc_data):
    """Save document to database."""
    session = get_db_session()
    try:
        document = Document(
            file_path=doc_data['file_path'],
            filename=doc_data['filename'],
            text_content=doc_data['text_content'],
            pages_data=doc_data['pages'],
            num_pages=doc_data['num_pages'],
            file_size=doc_data['file_size'],
            uploaded_at=datetime.fromisoformat(doc_data['uploaded_at'])
        )
        session.add(document)
        session.commit()
        session.refresh(document)
        return document
    except Exception as e:
        session.rollback()
        logger.error(f"Error saving document: {e}")
        raise
    finally:
        close_db_session(session)

def get_all_documents():
    """Get all documents from database."""
    session = get_db_session()
    try:
        documents = session.query(Document).order_by(Document.uploaded_at.desc()).all()
        return [
            {
                'file_path': doc.file_path,
                'filename': doc.filename,
                'num_pages': doc.num_pages,
                'uploaded_at': doc.uploaded_at.isoformat(),
                'file_size': doc.file_size
            }
            for doc in documents
        ]
    except Exception as e:
        logger.error(f"Error getting documents: {e}")
        raise
    finally:
        close_db_session(session)

def get_document_by_id(document_id):
    """Get document by ID."""
    session = get_db_session()
    try:
        document = session.query(Document).filter_by(file_path=document_id).first()
        if document:
            return {
                'file_path': document.file_path,
                'filename': document.filename,
                'text_content': document.text_content,
                'pages': document.pages_data,
                'num_pages': document.num_pages,
                'uploaded_at': document.uploaded_at.isoformat(),
                'file_size': document.file_size
            }
        return None
    except Exception as e:
        logger.error(f"Error getting document: {e}")
        raise
    finally:
        close_db_session(session)

def get_document_by_file_path(file_path):
    """Get document by file path."""
    session = get_db_session()
    try:
        logger.info(f"=== GET DOCUMENT BY FILE PATH ===")
        logger.info(f"Looking for file path: '{file_path}'")
        
        document = session.query(Document).filter_by(file_path=file_path).first()
        if document:
            logger.info(f"Document found: {document.filename}")
            return {
                'file_path': document.file_path,
                'filename': document.filename,
                'text_content': document.text_content,
                'pages': document.pages_data,
                'num_pages': document.num_pages,
                'uploaded_at': document.uploaded_at.isoformat(),
                'file_size': document.file_size
            }
        else:
            logger.warning(f"No document found for file path: '{file_path}'")
            # Let's also check what documents exist in the database
            all_docs = session.query(Document).all()
            logger.info(f"Total documents in database: {len(all_docs)}")
            for doc in all_docs:
                logger.info(f"  - {doc.file_path}")
        return None
    except Exception as e:
        logger.error(f"Error getting document by file path: {e}")
        raise
    finally:
        close_db_session(session)

def document_exists_by_file_path(file_path):
    """Check if document exists by file path."""
    session = get_db_session()
    try:
        document = session.query(Document).filter_by(file_path=file_path).first()
        return document is not None
    except Exception as e:
        logger.error(f"Error checking document existence: {e}")
        raise
    finally:
        close_db_session(session)

def delete_document(document_id):
    """Delete document from database and file system."""
    session = get_db_session()
    try:
        document = session.query(Document).filter_by(file_path=document_id).first()
        if document:
            # Delete the actual file from disk
            try:
                if os.path.exists(document.file_path):
                    os.remove(document.file_path)
                    logger.info(f"Deleted file from disk: {document.file_path}")
                else:
                    logger.warning(f"File not found on disk: {document.file_path}")
            except Exception as file_error:
                logger.error(f"Error deleting file from disk: {file_error}")
                # Continue with database deletion even if file deletion fails
            
            # Delete from database
            session.delete(document)
            session.commit()
            logger.info(f"Deleted document from database: {document.file_path}")
            return True
        return False
    except Exception as e:
        session.rollback()
        logger.error(f"Error deleting document: {e}")
        raise
    finally:
        close_db_session(session)

def save_chat_session(session_data):
    """Save chat session to database."""
    session = get_db_session()
    try:
        chat_session = ChatSession(
            id=session_data['id'],
            document_file_path=session_data['document_file_path'],
            created_at=datetime.fromisoformat(session_data['created_at'])
        )
        session.add(chat_session)
        session.commit()
        session.refresh(chat_session)
        return chat_session
    except Exception as e:
        session.rollback()
        logger.error(f"Error saving chat session: {e}")
        raise
    finally:
        close_db_session(session)

def save_chat_message(message_data):
    """Save chat message to database."""
    session = get_db_session()
    try:
        message = ChatMessage(
            id=message_data['id'],
            chat_session_id=message_data['chat_session_id'],
            role=message_data['role'],
            content=message_data['content'],
            timestamp=datetime.fromisoformat(message_data['timestamp']),
            page_range=message_data.get('page_range'),
            references=message_data.get('references')
        )
        session.add(message)
        session.commit()
        session.refresh(message)
        return message
    except Exception as e:
        session.rollback()
        logger.error(f"Error saving chat message: {e}")
        raise
    finally:
        close_db_session(session)

def get_chat_session(session_id):
    """Get chat session with messages."""
    session = get_db_session()
    try:
        chat_session = session.query(ChatSession).filter_by(id=session_id).first()
        if chat_session:
            return {
                'id': chat_session.id,
                'document_file_path': chat_session.document_file_path,
                'created_at': chat_session.created_at.isoformat(),
                'messages': [
                    {
                        'id': msg.id,
                        'role': msg.role,
                        'content': msg.content,
                        'timestamp': msg.timestamp.isoformat(),
                        'page_range': msg.page_range,
                        'references': msg.references
                    }
                    for msg in chat_session.messages
                ]
            }
        return None
    except Exception as e:
        logger.error(f"Error getting chat session: {e}")
        raise
    finally:
        close_db_session(session)

def delete_chat_session(session_id):
    """Delete chat session from database."""
    session = get_db_session()
    try:
        chat_session = session.query(ChatSession).filter_by(id=session_id).first()
        if chat_session:
            session.delete(chat_session)
            session.commit()
            return True
        return False
    except Exception as e:
        session.rollback()
        logger.error(f"Error deleting chat session: {e}")
        raise
    finally:
        close_db_session(session)

def get_chat_sessions_for_document(document_id):
    """Get all chat sessions for a document."""
    session = get_db_session()
    try:
        chat_sessions = session.query(ChatSession).filter_by(document_file_path=document_id).order_by(ChatSession.created_at.desc()).all()
        return [
            {
                'id': cs.id,
                'created_at': cs.created_at.isoformat(),
                'message_count': len(cs.messages)
            }
            for cs in chat_sessions
        ]
    except Exception as e:
        logger.error(f"Error getting chat sessions: {e}")
        raise
    finally:
        close_db_session(session)

def update_document_text(document_id, text_content, pages_data):
    """Update document text content and pages data."""
    session = get_db_session()
    try:
        document = session.query(Document).filter_by(file_path=document_id).first()
        if document:
            document.text_content = text_content
            document.pages_data = pages_data
            document.num_pages = len(pages_data)
            session.commit()
            logger.info(f"Document text updated successfully: {document_id}")
            return True
        else:
            logger.error(f"Document not found: {document_id}")
            return False
    except Exception as e:
        session.rollback()
        logger.error(f"Error updating document text: {e}")
        raise
    finally:
        close_db_session(session)

def update_document_name(document_id, new_name):
    """Update document original filename."""
    session = get_db_session()
    try:
        document = session.query(Document).filter_by(file_path=document_id).first()
        if document:
            document.filename = new_name
            session.commit()
            logger.info(f"Document name updated successfully: {document_id} -> {new_name}")
            return True
        else:
            logger.error(f"Document not found: {document_id}")
            return False
    except Exception as e:
        session.rollback()
        logger.error(f"Error updating document name: {e}")
        raise
    finally:
        close_db_session(session)
