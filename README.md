# Chatbot Agentic multi-tenant para WooCommerce

Este proyecto es un sistema de chatbot conversacional inteligente (agente de IA) multi-tenant diseñado para integrarse con tiendas de WooCommerce. 

## 🚀 Arquitectura del Proyecto

El sistema está compuesto por:
1.  **Backend (NestJS):** Orquestador de la conversación (Agentic Loop), ejecución de herramientas de WooCommerce (consulta de stock, estado del pedido, buscar productos, y añadir al carrito) y conexión al LLM.
2.  **Widget (Vite + React):** Un widget de chat autoinyectable encapsulado en un **Shadow DOM**, garantizando que los estilos CSS no tengan conflictos con la web anfitriona.
3.  **Base de Datos (PostgreSQL):** Almacena de forma persistente la configuración de cada tienda (Tenant): prompts de sistema, URL del sitio WooCommerce, claves de API de WooCommerce y herramientas habilitadas.
4.  **Caché (Redis):** Persiste el historial de mensajes de los chats de forma asíncrona mediante un cliente de alto rendimiento, aplicando un **TTL nativo de 30 minutos** para liberar memoria del servidor.

---

## 🛠️ Requisitos Previos

Asegúrate de tener instalado en tu sistema local:
*   [Docker](https://www.docker.com/products/docker-desktop)
*   [Docker Compose](https://docs.docker.com/compose/install/)

---

## 🏁 Guía de Inicio Rápido (Despliegue con Docker)

Sigue estos pasos para levantar todo el proyecto desde cero en tu máquina local:

### 1. Variables de Entorno
Copia el archivo `.env.example` en la raíz del proyecto y renómbralo a `.env`:
```bash
cp .env.example .env
```
Abre el archivo `.env` y configura tu API Key del LLM (ej. de Groq o Google Gemini) junto con las claves correspondientes.

### 2. Levantar el Entorno en Docker
Compila y levanta la base de datos Postgres, el servidor de caché Redis y el servidor de NestJS con el widget integrado en segundo plano:
```bash
docker compose up --build -d
```
*Nota: Al iniciar por primera vez, el backend ejecutará automáticamente las migraciones iniciales de Prisma (`npx prisma migrate deploy`) para estructurar las tablas de la base de datos.*

### 3. Importar la Base de Datos Inicial (Volcado SQL)
Para tener el entorno funcional de inmediato, debes importar el respaldo de base de datos de tu compañero (`respaldo_agente.sql`), el cual contiene la configuración del Tenant y sus WooCommerce Keys reales.

Ejecuta en tu terminal:
```bash
# A) Vaciar el esquema generado por las migraciones iniciales para evitar conflictos de claves duplicadas
docker exec -i bot_postgres psql -U botuser -d botdb -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# B) Importar el volcado de base de datos SQL
docker exec -i bot_postgres psql -U botuser -d botdb < respaldo_agente.sql
```

### 4. Configurar el Script en WordPress / HTML
Una vez importada la base de datos, el identificador único (ID) del Tenant configurado será **`cmprh438b0002fgbkqslxem5t`**.

Debes asegurarte de que el código del script que pegas en tu sitio de WordPress (o en tu playground HTML local `widget/index.html`) coincida exactamente con este ID en el atributo `data-tenant` para que el backend reconozca la tienda:

```html
<script 
  src="http://localhost:3000/widget.js" 
  data-tenant="cmprh438b0002fgbkqslxem5t" 
  data-color="#10b981" 
  data-bot-name="Asistente de Compras"
></script>
```

### 5. Reiniciar el Backend
Reinicia el servicio backend para asegurar la correcta conexión y lectura de los datos recién importados:
```bash
docker compose restart app
```

---

## 🧪 Pruebas Locales del Widget

El widget de chat se sirve estáticamente en la URL: `http://localhost:3000/widget.js`

1.  Abre el archivo de playground local `widget/index.html` en tu navegador (el cual ya está configurado con el ID `cmprh438b0002fgbkqslxem5t`).
2.  Interactúa con el chatbot enviando preguntas sobre productos, stock o simulando adición al carrito.

---

## 💾 Monitoreo de Sesiones en Redis

Para asegurarte de que el historial se persiste con el TTL de 30 minutos, conéctate al CLI de tu contenedor Redis:

```bash
docker exec -it bot_redis redis-cli
```

Comandos útiles en `redis-cli`:
*   `KEYS *`: Muestra las claves de sesión activas (formato `session:sess_...`).
*   `TTL session:<session_id>`: Muestra los segundos restantes de la sesión antes de expirar (inicia en `1800` segundos).
*   `GET session:<session_id>`: Imprime el JSON completo con los mensajes de la conversación guardada.
