#!/bin/bash

# =============================================================================
# SKIM2 PRODUCTION DEPLOYMENT SCRIPT
# =============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

# =============================================================================
# PRE-DEPLOYMENT CHECKS
# =============================================================================

log "Starting SKIM2 production deployment..."

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   error "This script should not be run as root"
   exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    error ".env file not found. Please create it from env.example"
    exit 1
fi

# =============================================================================
# ENVIRONMENT SETUP
# =============================================================================

log "Setting up environment..."

# Create necessary directories
mkdir -p logs uploads backups ssl monitoring/grafana/dashboards monitoring/grafana/datasources

# Set proper permissions
chmod 755 logs uploads backups
chmod 600 .env

# =============================================================================
# SECURITY SETUP
# =============================================================================

log "Setting up security..."

# Generate SSL certificates if not present
if [ ! -f ssl/cert.pem ] || [ ! -f ssl/key.pem ]; then
    log "Generating self-signed SSL certificates..."
    mkdir -p ssl
    openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
    chmod 600 ssl/key.pem
    chmod 644 ssl/cert.pem
    warn "Self-signed certificates generated. For production, use proper SSL certificates."
fi

# Generate secure secrets if not present
if [ ! -f .env ]; then
    error ".env file not found. Please create it from env.example"
    exit 1
fi

# Check if JWT_SECRET_KEY is set
if ! grep -q "JWT_SECRET_KEY=" .env || grep -q "your_256_bit_jwt_secret_key_here" .env; then
    log "Generating JWT secret key..."
    JWT_SECRET=$(openssl rand -hex 32)
    sed -i "s/your_256_bit_jwt_secret_key_here/$JWT_SECRET/" .env
fi

# Check if SECRET_KEY is set
if ! grep -q "SECRET_KEY=" .env || grep -q "your_256_bit_flask_secret_key_here" .env; then
    log "Generating Flask secret key..."
    SECRET_KEY=$(openssl rand -hex 32)
    sed -i "s/your_256_bit_flask_secret_key_here/$SECRET_KEY/" .env
fi

# =============================================================================
# DATABASE SETUP
# =============================================================================

log "Setting up database..."

# Check if PostgreSQL is configured
if grep -q "DATABASE_URL=postgresql://" .env; then
    log "PostgreSQL database configured"
else
    warn "Using SQLite for development. For production, configure PostgreSQL in .env"
fi

# =============================================================================
# DOCKER BUILD
# =============================================================================

log "Building Docker images..."

# Build the application
docker-compose build --no-cache

if [ $? -ne 0 ]; then
    error "Docker build failed"
    exit 1
fi

# =============================================================================
# DATABASE MIGRATION
# =============================================================================

log "Running database migrations..."

# Start database services
docker-compose up -d postgres redis

# Wait for database to be ready
log "Waiting for database to be ready..."
sleep 30

# Run database migration
docker-compose run --rm backend python database_migrations.py migrate

if [ $? -ne 0 ]; then
    error "Database migration failed"
    exit 1
fi

# =============================================================================
# APPLICATION DEPLOYMENT
# =============================================================================

log "Deploying application..."

# Start all services
docker-compose up -d

# Wait for services to be ready
log "Waiting for services to start..."
sleep 60

# Check service health
log "Checking service health..."

# Check backend health
if curl -f http://localhost:5000/health > /dev/null 2>&1; then
    log "Backend is healthy"
else
    error "Backend health check failed"
    docker-compose logs backend
    exit 1
fi

# Check database health
if docker-compose exec postgres pg_isready -U skim2_user -d skim2_db > /dev/null 2>&1; then
    log "Database is healthy"
else
    error "Database health check failed"
    exit 1
fi

# =============================================================================
# MONITORING SETUP
# =============================================================================

log "Setting up monitoring..."

# Create Grafana datasource
cat > monitoring/grafana/datasources/prometheus.yml << EOF
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
EOF

# Create basic dashboard
cat > monitoring/grafana/dashboards/skim2-dashboard.json << EOF
{
  "dashboard": {
    "id": null,
    "title": "SKIM2 Dashboard",
    "tags": ["skim2"],
    "timezone": "browser",
    "panels": [
      {
        "id": 1,
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "{{method}} {{endpoint}}"
          }
        ]
      },
      {
        "id": 2,
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          }
        ]
      }
    ]
  }
}
EOF

# =============================================================================
# BACKUP SETUP
# =============================================================================

log "Setting up backup system..."

# Create backup script
cat > scripts/backup.sh << 'EOF'
#!/bin/bash
set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"

# Database backup
pg_dump -h postgres -U skim2_user -d skim2_db > "$BACKUP_DIR/db_backup_$TIMESTAMP.sql"

# File backup
tar -czf "$BACKUP_DIR/files_backup_$TIMESTAMP.tar.gz" -C /app uploads/

# Clean old backups (keep last 30 days)
find "$BACKUP_DIR" -name "*.sql" -mtime +30 -delete
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +30 -delete

echo "Backup completed: $TIMESTAMP"
EOF

chmod +x scripts/backup.sh

# =============================================================================
# SECURITY HARDENING
# =============================================================================

log "Applying security hardening..."

# Set up firewall rules (if available)
if command -v ufw &> /dev/null; then
    log "Configuring firewall..."
    sudo ufw allow 22/tcp
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw --force enable
fi

# =============================================================================
# FINAL CHECKS
# =============================================================================

log "Running final health checks..."

# Check all services
docker-compose ps

# Test API endpoints
log "Testing API endpoints..."

# Test health endpoint
if curl -f http://localhost/health > /dev/null 2>&1; then
    log "Health endpoint is working"
else
    error "Health endpoint failed"
fi

# Test SSL
if curl -f -k https://localhost/health > /dev/null 2>&1; then
    log "SSL is working"
else
    error "SSL configuration failed"
fi

# =============================================================================
# DEPLOYMENT COMPLETE
# =============================================================================

log "Deployment completed successfully!"
log ""
log "SKIM2 is now running at:"
log "  - HTTP:  http://localhost"
log "  - HTTPS: https://localhost"
log "  - API:   http://localhost/api"
log ""
log "Monitoring:"
log "  - Grafana: http://localhost:3000 (admin/admin_password)"
log "  - Prometheus: http://localhost:9090"
log ""
log "Next steps:"
log "  1. Update DNS to point to your server"
log "  2. Replace self-signed SSL certificates with proper ones"
log "  3. Configure backup monitoring"
log "  4. Set up log rotation"
log "  5. Configure monitoring alerts"
log ""
log "To view logs: docker-compose logs -f"
log "To stop: docker-compose down"
log "To restart: docker-compose restart" 