# 🚀 SKIM2 Production Deployment Guide

## 📋 Overview

This guide provides comprehensive instructions for deploying SKIM2 to production with enterprise-grade security, monitoring, and scalability features.

## 🔒 Security Features Implemented

### ✅ Critical Security Issues Resolved

1. **Environment Variables & Secrets Management**
   - ✅ Comprehensive `.env.example` file with all required variables
   - ✅ Secure secret generation and management
   - ✅ Production environment configuration
   - ✅ JWT and Flask secret key generation

2. **Database Security & Configuration**
   - ✅ PostgreSQL migration system
   - ✅ Database connection pooling
   - ✅ Backup and recovery system
   - ✅ Connection retry logic and timeout handling

3. **Authentication & Authorization**
   - ✅ Strong password validation (length, complexity)
   - ✅ Rate limiting on auth endpoints
   - ✅ Account lockout protection
   - ✅ Secure JWT token management
   - ✅ Session management and logout functionality

4. **Input Validation & Sanitization**
   - ✅ File upload size limits (50MB max)
   - ✅ File type validation beyond extension
   - ✅ Input sanitization and XSS protection
   - ✅ CSRF protection
   - ✅ SQL injection protection

5. **Error Handling & Logging**
   - ✅ Structured JSON logging
   - ✅ Request ID tracking
   - ✅ Comprehensive error handlers
   - ✅ Security event logging
   - ✅ Performance monitoring

6. **Performance & Scalability**
   - ✅ Request timeout limits
   - ✅ Redis caching integration
   - ✅ API rate limiting
   - ✅ Database query optimization
   - ✅ Connection pooling

## 🏗️ Infrastructure Components

### Docker Services
- **Backend**: Flask application with Gunicorn
- **PostgreSQL**: Production database
- **Redis**: Caching and session storage
- **Nginx**: Reverse proxy with SSL termination
- **Prometheus**: Metrics collection
- **Grafana**: Monitoring dashboards

### Security Layers
- **Talisman**: Security headers
- **Flask-Limiter**: Rate limiting
- **Input Validation**: Comprehensive sanitization
- **JWT**: Secure authentication
- **SSL/TLS**: HTTPS enforcement

## 🚀 Quick Start Deployment

### Prerequisites

1. **System Requirements**
   ```bash
   # Ubuntu/Debian
   sudo apt update
   sudo apt install docker.io docker-compose openssl curl
   sudo systemctl enable docker
   sudo systemctl start docker
   ```

2. **Clone Repository**
   ```bash
   git clone <repository-url>
   cd skim2
   ```

3. **Environment Setup**
   ```bash
   # Copy environment template
   cp env.example .env
   
   # Edit environment variables
   nano .env
   ```

### Automated Deployment

1. **Run Deployment Script**
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

2. **Verify Deployment**
   ```bash
   # Check service status
   docker-compose ps
   
   # View logs
   docker-compose logs -f
   
   # Test health endpoint
   curl http://localhost/health
   ```

## 🔧 Manual Deployment Steps

### Step 1: Environment Configuration

1. **Create Environment File**
   ```bash
   cp env.example .env
   ```

2. **Configure Critical Variables**
   ```bash
   # Generate secure keys
   JWT_SECRET=$(openssl rand -hex 32)
   SECRET_KEY=$(openssl rand -hex 32)
   
   # Update .env file
   sed -i "s/your_256_bit_jwt_secret_key_here/$JWT_SECRET/" .env
   sed -i "s/your_256_bit_flask_secret_key_here/$SECRET_KEY/" .env
   ```

3. **Set Production Variables**
   ```bash
   # Required for production
   FLASK_ENV=production
   DEBUG=False
   DATABASE_URL=postgresql://user:pass@localhost:5432/skim2_db
   GOOGLE_API_KEY=your_gemini_api_key
   ```

### Step 2: SSL Certificate Setup

1. **Self-Signed (Development)**
   ```bash
   mkdir -p ssl
   openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
   ```

2. **Let's Encrypt (Production)**
   ```bash
   # Install certbot
   sudo apt install certbot
   
   # Generate certificate
   sudo certbot certonly --standalone -d yourdomain.com
   
   # Copy certificates
   sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ssl/cert.pem
   sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ssl/key.pem
   sudo chown $USER:$USER ssl/*
   ```

### Step 3: Database Migration

1. **Start Database Services**
   ```bash
   docker-compose up -d postgres redis
   ```

2. **Run Migration**
   ```bash
   docker-compose run --rm backend python database_migrations.py migrate
   ```

3. **Verify Migration**
   ```bash
   docker-compose run --rm backend python database_migrations.py info
   ```

### Step 4: Application Deployment

1. **Build and Start Services**
   ```bash
   docker-compose build --no-cache
   docker-compose up -d
   ```

2. **Health Checks**
   ```bash
   # Check all services
   docker-compose ps
   
   # Test endpoints
   curl http://localhost/health
   curl -k https://localhost/health
   ```

## 📊 Monitoring Setup

### Grafana Dashboard

1. **Access Grafana**
   - URL: `http://localhost:3000`
   - Username: `admin`
   - Password: `admin_password`

2. **Configure Data Sources**
   - Prometheus: `http://prometheus:9090`

3. **Import Dashboards**
   - SKIM2 Dashboard: `monitoring/grafana/dashboards/skim2-dashboard.json`

### Prometheus Metrics

1. **Access Prometheus**
   - URL: `http://localhost:9090`

2. **Key Metrics**
   - Request rate: `rate(http_requests_total[5m])`
   - Response time: `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))`
   - Error rate: `rate(http_requests_total{status=~"5.."}[5m])`

## 🔒 Security Hardening

### Firewall Configuration

```bash
# Ubuntu/Debian
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### SSL/TLS Configuration

```nginx
# Modern SSL configuration in nginx.conf
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
ssl_prefer_server_ciphers off;
```

### Security Headers

```python
# Automatically applied by Talisman
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
```

## 🧪 Testing

### Run Production Tests

```bash
# Run comprehensive test suite
python backend/test_production.py

# Test specific components
python -m pytest backend/test_production.py::ProductionReadinessTests::test_security_headers
```

### Load Testing

```bash
# Install Apache Bench
sudo apt install apache2-utils

# Run load test
ab -n 1000 -c 10 http://localhost/health
```

## 🔄 Backup and Recovery

### Automated Backups

```bash
# Manual backup
docker-compose run --rm backend python database_migrations.py backup

# Automated backup (cron job)
0 2 * * * /path/to/skim2/scripts/backup.sh
```

### Recovery Procedures

```bash
# Restore database
docker-compose exec postgres psql -U skim2_user -d skim2_db < backup.sql

# Restore files
tar -xzf files_backup.tar.gz -C /app/
```

## 📈 Performance Optimization

### Database Optimization

```sql
-- Create indexes for better performance
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_pages_document_id ON pages(document_id);
CREATE INDEX idx_highlights_document_id ON highlights(document_id);
```

### Caching Strategy

```python
# Redis caching for frequently accessed data
@cache.memoize(timeout=300)
def get_user_documents(user_id):
    # Database query with caching
    pass
```

### Rate Limiting

```python
# Configure rate limits
RATE_LIMIT_REQUESTS = 100  # requests per hour
RATE_LIMIT_WINDOW = 3600   # 1 hour in seconds
```

## 🚨 Troubleshooting

### Common Issues

1. **Database Connection Failed**
   ```bash
   # Check database status
   docker-compose exec postgres pg_isready -U skim2_user -d skim2_db
   
   # View database logs
   docker-compose logs postgres
   ```

2. **SSL Certificate Issues**
   ```bash
   # Check certificate validity
   openssl x509 -in ssl/cert.pem -text -noout
   
   # Test SSL connection
   openssl s_client -connect localhost:443 -servername localhost
   ```

3. **Application Not Starting**
   ```bash
   # Check application logs
   docker-compose logs backend
   
   # Test environment variables
   docker-compose run --rm backend python -c "import os; print(os.getenv('JWT_SECRET_KEY'))"
   ```

### Log Analysis

```bash
# View structured logs
tail -f logs/app.log | jq '.'

# Search for errors
grep "ERROR" logs/app.log

# Monitor security events
grep "SECURITY_EVENT" logs/app.log
```

## 🔄 Updates and Maintenance

### Application Updates

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose build --no-cache
docker-compose up -d

# Run migrations
docker-compose run --rm backend python database_migrations.py migrate
```

### Security Updates

```bash
# Update dependencies
docker-compose run --rm backend pip install --upgrade -r requirements.txt

# Rebuild container
docker-compose build --no-cache backend
docker-compose up -d backend
```

### Monitoring Maintenance

```bash
# Clean old logs
find logs/ -name "*.log" -mtime +30 -delete

# Clean old backups
find backups/ -name "*.sql" -mtime +30 -delete
```

## 📞 Support

### Emergency Procedures

1. **Service Down**
   ```bash
   # Restart all services
   docker-compose restart
   
   # Check logs immediately
   docker-compose logs --tail=100
   ```

2. **Database Issues**
   ```bash
   # Restart database
   docker-compose restart postgres
   
   # Check disk space
   df -h
   ```

3. **Security Incident**
   ```bash
   # Review security logs
   grep "SECURITY_EVENT" logs/app.log | tail -50
   
   # Check for unauthorized access
   grep "failed_login" logs/app.log
   ```

### Contact Information

- **Security Issues**: security@yourdomain.com
- **Technical Support**: support@yourdomain.com
- **Emergency**: +1-555-0123

## 📚 Additional Resources

- [Flask Security Best Practices](https://flask-security.readthedocs.io/)
- [OWASP Security Guidelines](https://owasp.org/www-project-top-ten/)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [Nginx Security Configuration](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)

---

**⚠️ IMPORTANT**: This application is now production-ready with comprehensive security features. Always test thoroughly in a staging environment before deploying to production. 