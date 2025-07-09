#!/usr/bin/env python3
"""
Skim - Text Analysis Grid Application
Run script to start both frontend and backend servers
"""

import os
import sys
import subprocess
import time
import signal
import threading
from pathlib import Path

class ServerManager:
    def __init__(self):
        self.frontend_process = None
        self.backend_process = None
        self.running = True
        
    def start_backend(self):
        """Start the Flask backend server"""
        print("🚀 Starting Flask backend server...")
        backend_dir = Path("backend")
        if not backend_dir.exists():
            print("❌ Backend directory not found!")
            return False
            
        try:
            # Check if requirements are installed
            import google.generativeai
            import flask
            import pydantic
        except ImportError as e:
            print(f"❌ Missing required packages: {e}")
            print("Please install requirements: pip install -r backend/requirements.txt")
            return False
            
        # Start backend server
        self.backend_process = subprocess.Popen(
            [sys.executable, "backend/app.py"],
            cwd=os.getcwd(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        
        # Wait a moment and check if it started successfully
        time.sleep(2)
        if self.backend_process.poll() is not None:
            print("❌ Backend server failed to start!")
            return False
            
        print("✅ Backend server started on http://localhost:5001")
        return True
        
    def start_frontend(self):
        """Start the React frontend development server"""
        print("🚀 Starting React frontend server...")
        
        # Check if node_modules exists
        if not Path("node_modules").exists():
            print("📦 Installing npm dependencies...")
            try:
                subprocess.run(["npm", "install"], check=True, capture_output=True)
                print("✅ Dependencies installed")
            except subprocess.CalledProcessError as e:
                print(f"❌ Failed to install dependencies: {e}")
                return False
                
        # Start frontend server
        self.frontend_process = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd=os.getcwd(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        
        # Wait a moment and check if it started successfully
        time.sleep(3)
        if self.frontend_process.poll() is not None:
            print("❌ Frontend server failed to start!")
            return False
            
        print("✅ Frontend server started on http://localhost:5173")
        return True
        
    def monitor_backend(self):
        """Monitor backend server output"""
        if self.backend_process:
            for line in iter(self.backend_process.stdout.readline, ''):
                if not self.running:
                    break
                if line.strip():
                    print(f"[Backend] {line.strip()}")
                    
    def monitor_frontend(self):
        """Monitor frontend server output"""
        if self.frontend_process:
            for line in iter(self.frontend_process.stdout.readline, ''):
                if not self.running:
                    break
                if line.strip():
                    print(f"[Frontend] {line.strip()}")
                    
    def stop_servers(self):
        """Stop both servers gracefully"""
        print("\n🛑 Stopping servers...")
        self.running = False
        
        if self.backend_process:
            self.backend_process.terminate()
            try:
                self.backend_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.backend_process.kill()
            print("✅ Backend server stopped")
            
        if self.frontend_process:
            self.frontend_process.terminate()
            try:
                self.frontend_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.frontend_process.kill()
            print("✅ Frontend server stopped")
            
    def run(self):
        """Main run method"""
        print("=" * 60)
        print("📊 Skim - Text Analysis Grid Application")
        print("=" * 60)
        
        # Check if .env file exists for API key
        if not Path(".env").exists():
            print("⚠️  Warning: No .env file found!")
            print("   Create a .env file with your GOOGLE_API_KEY:")
            print("   GOOGLE_API_KEY=your_api_key_here")
            print()
            
        # Start backend first
        if not self.start_backend():
            print("❌ Failed to start backend server")
            return 1
            
        # Start frontend
        if not self.start_frontend():
            print("❌ Failed to start frontend server")
            self.stop_servers()
            return 1
            
        print("\n" + "=" * 60)
        print("🎉 Application is running!")
        print("📱 Frontend: http://localhost:5173")
        print("🔧 Backend:  http://localhost:5001")
        print("📖 API Docs: http://localhost:5001/")
        print("=" * 60)
        print("Press Ctrl+C to stop both servers")
        print()
        
        # Start monitoring threads
        backend_thread = threading.Thread(target=self.monitor_backend, daemon=True)
        frontend_thread = threading.Thread(target=self.monitor_frontend, daemon=True)
        
        backend_thread.start()
        frontend_thread.start()
        
        try:
            # Keep main thread alive
            while self.running:
                time.sleep(1)
                
                # Check if processes are still running
                if self.backend_process and self.backend_process.poll() is not None:
                    print("❌ Backend server stopped unexpectedly")
                    break
                    
                if self.frontend_process and self.frontend_process.poll() is not None:
                    print("❌ Frontend server stopped unexpectedly")
                    break
                    
        except KeyboardInterrupt:
            print("\n🛑 Received interrupt signal")
        finally:
            self.stop_servers()
            
        print("👋 Goodbye!")
        return 0

def main():
    """Main entry point"""
    manager = ServerManager()
    
    # Set up signal handlers for graceful shutdown
    def signal_handler(signum, frame):
        print(f"\n🛑 Received signal {signum}")
        manager.stop_servers()
        sys.exit(0)
        
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Run the application
    exit_code = manager.run()
    sys.exit(exit_code)

if __name__ == "__main__":
    main() 