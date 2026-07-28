# Seguridad operacional

## Secretos y volcados SQL

Los archivos `.env` y los volcados SQL no deben versionarse ni compartirse.
Si una clave de WooCommerce, Odoo, LLM, JWT o base de datos apareció en un
volcado, log o repositorio, trátala como comprometida: revócala y genera una
nueva antes de desplegar. Los volcados existentes se conservan localmente para
no borrar datos del usuario, pero deben retirarse del historial Git mediante un
proceso aprobado de limpieza de secretos.

## Despliegue

- Define `JWT_SECRET`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` y
  `CORS_ORIGINS` con valores generados fuera del repositorio.
- Limita `CONNECTOR_ALLOWED_HOSTS` a los dominios de conectores esperados.
- Mantén Postgres, Redis, el API y el panel detrás de un reverse proxy con TLS;
  el `docker-compose.yml` incluido solo publica los puertos en localhost.
- Usa `BOOTSTRAP_TOKEN` únicamente durante la creación del primer administrador
  y elimínalo después.
