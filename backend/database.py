import os
import logging
from sqlalchemy import (
    create_engine, Column, Integer, String, Float, ForeignKey, DateTime, Text, JSON
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from datetime import datetime

logger = logging.getLogger(__name__)

Base = declarative_base()
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app.db')
engine = create_engine(f'sqlite:///{DB_PATH}', echo=False, future=True, connect_args={'timeout': 30, 'check_same_thread': False})
SessionLocal = sessionmaker(bind=engine)

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    documents = relationship('Document', back_populates='user')
    highlights = relationship('Highlight', back_populates='user')
    chat_sessions = relationship('ChatSession', back_populates='user')

class Document(Base):
    __tablename__ = 'documents'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'))
    filename = Column(String, nullable=False)
    original_filename = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    num_pages = Column(Integer)
    meta = Column(JSON)
    user = relationship('User', back_populates='documents')
    pages = relationship('Page', back_populates='document')
    highlights = relationship('Highlight', back_populates='document')
    chat_sessions = relationship('ChatSession', back_populates='document')

    def to_dict(self):
        """Convert document to dictionary for JSON serialization."""
        return {
            'document_id': self.id,
            'user_id': self.user_id,
            'filename': self.filename,
            'original_filename': self.original_filename,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'num_pages': self.num_pages,
            'meta': self.meta,
            'file_exists': getattr(self, 'file_exists', None),
            'file_size': getattr(self, 'file_size', None)
        }

class Page(Base):
    __tablename__ = 'pages'
    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey('documents.id'))
    page_number = Column(Integer, nullable=False)
    text_content = Column(Text)  # Renamed from ocr_text for clarity
    created_at = Column(DateTime, default=datetime.utcnow)
    document = relationship('Document', back_populates='pages')
    words = relationship('Word', back_populates='page')
    highlights = relationship('Highlight', back_populates='page')

class Word(Base):
    __tablename__ = 'words'
    id = Column(Integer, primary_key=True)
    page_id = Column(Integer, ForeignKey('pages.id'))
    word_index = Column(Integer)
    text = Column(String)
    x = Column(Float)
    y = Column(Float)
    width = Column(Float)
    height = Column(Float)
    confidence = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)
    page = relationship('Page', back_populates='words')

class Highlight(Base):
    __tablename__ = 'highlights'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'))
    document_id = Column(Integer, ForeignKey('documents.id'))
    page_id = Column(Integer, ForeignKey('pages.id'))
    word_ids = Column(JSON)  # List of word IDs
    color = Column(String, default='#ffe066')
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship('User', back_populates='highlights')
    document = relationship('Document', back_populates='highlights')
    page = relationship('Page', back_populates='highlights')

class ChatSession(Base):
    __tablename__ = 'chat_sessions'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'))
    document_id = Column(Integer, ForeignKey('documents.id'))
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship('User', back_populates='chat_sessions')
    document = relationship('Document', back_populates='chat_sessions')
    messages = relationship('ChatMessage', back_populates='chat_session')

class ChatMessage(Base):
    __tablename__ = 'chat_messages'
    id = Column(Integer, primary_key=True)
    chat_session_id = Column(Integer, ForeignKey('chat_sessions.id'))
    sender = Column(String)  # 'user' or 'assistant'
    message = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    reference_word_ids = Column(JSON)  # List of word IDs
    reference_page = Column(Integer)  # Legacy field - keeping for backward compatibility
    reference_quote = Column(Text)  # Legacy field - keeping for backward compatibility
    page_range = Column(JSON)  # Store the page range used for this message
    references = Column(JSON)  # Store all references as JSON array
    chat_session = relationship('ChatSession', back_populates='messages')

def init_db():
    """Initialize the database with required tables."""
    Base.metadata.create_all(engine)

# Utility to get a session

def get_db_session():
    return SessionLocal() 