# 🤖 Chatbot Agentic Multi-Tenant & Multi-Conector

Este proyecto es un sistema de chatbot conversacional inteligente (agente de IA) multi-tenant y multi-conector, diseñado para integrarse con múltiples plataformas de e-commerce y bases de datos de forma dinámica en caliente.

El chatbot es capaz de interactuar con clientes reales resolviendo consultas sobre catálogos, stock de productos, agregar elementos al carrito y verificar el estado de pedidos.

---

## 🚀 Arquitectura del Proyecto

El sistema está compuesto por:

1. **Backend (NestJS - Puerto 3000):** Orquestador de la conversación (Agentic Loop), ejecución de herramientas de venta (consulta de stock, estado del pedido, buscar productos y añadir al carrito) y comunicación con LLMs en la nube (Groq, OpenAI, Gemini) o locales (Ollama).
2. **Panel de Administración (React + Vite + Lucide - Puerto 5173):** Panel administrativo premium donde se pueden crear, actualizar y desactivar bots (tenants), elegir el tipo de conector, rellenar sus credenciales (encriptadas automáticamente) y activar/desactivar herramientas específicas.
3. **Widget de Cliente (React + Vite):** Widget de chat autoinyectable encapsulado en un **Shadow DOM**, garantizando que los estilos CSS no tengan conflictos con la web anfitriona. Se sirve estáticamente en `http://localhost:3000/widget.js`.
4. **Base de Datos (PostgreSQL):** Almacena de forma persistente la configuración de cada bot y sus conectores cifrados mediante Prisma ORM.
5. **Caché de Turnos (Redis - Puerto 6379):** Persiste el historial de mensajes de los chats de forma asíncrona, aplicando un **TTL nativo de 30 minutos** para liberar memoria del servidor automáticamente.

---

## 🔌 Conectores Soportados

El sistema es agnóstico a la plataforma. Soporta tres conectores que implementan una interfaz común (`ICommerceConnector`):

* **WooCommerce:** Conexión vía API REST usando las claves `consumerKey` y `consumerSecret`.
* **Odoo:** Conexión mediante **JSON-RPC nativo** (compatible con Odoo 12 a 18+). Permite autenticación tradicional o vía API Key (Odoo 14+), resuelve categorías por nombre, y expone imágenes públicas dinámicas para optimizar consumo de red y tokens.
* **Base de Datos Directa (Direct SQL):** Conexión TCP directa a bases de datos **PostgreSQL o MySQL**. Cuenta con mapeo dinámico de tablas y columnas (personalizable desde el Panel Admin) e indexa IDs alfanuméricos (como UUIDs o SKUs).

---

## 🛠️ Requisitos Previos

Asegúrate de tener instalado en tu sistema local:
* [Docker](https://www.docker.com/products/docker-desktop)
* [Docker Compose](https://docs.docker.com/compose/install/)

---

## 🏁 Guía de Inicio Rápido (Despliegue con Docker)

Sigue estos pasos para levantar todo el proyecto desde cero en tu máquina local:

### 1. Variables de Entorno
Copia el archivo `.env.example` en la raíz del proyecto y renómbralo a `.env`:
```bash
cp .env.example .env
```
Abre el archivo `.env` y configura tus API Keys del LLM que desees usar (ej. `GROQ_API_KEY`, `OPENAI_API_KEY` o `GOOGLE_API_KEY`).

### 2. Levantar el Entorno en Docker
Compila y levanta la base de datos Postgres, el servidor de caché Redis, el backend NestJS y el panel React en segundo plano:
```bash
docker compose up --build -d
```
*Nota: Al iniciar por primera vez, el contenedor de la aplicación ejecutará automáticamente las migraciones iniciales de Prisma (`npx prisma migrate deploy`) para estructurar la base de datos Postgres.*

### 3. Crear el primer Bot en el Panel Admin
1. Ingresa al panel de administración en tu navegador: **`http://localhost:5173`**
2. Inicia sesión con las credenciales por defecto (o regístrate si no tienes cuenta).
3. Haz clic en **＋ Nuevo Bot** y configura:
   * **Nombre del Bot:** Nombre público que se mostrará en el widget.
   * **System Prompt:** Personalidad y contexto del bot (sin necesidad de escribir reglas de herramientas, el backend las inyecta de forma dinámica).
   * **Tipo de Conector:** Selecciona `WooCommerce`, `Odoo` o `Base de Datos Directa`.
   * **Credenciales:** Escribe las credenciales de acceso de tu catálogo (URLs, tokens, hosts).
   * **Herramientas activas:** Marca las capacidades que el bot tendrá permitidas ejecutar en esa tienda.
4. Haz clic en **Crear Bot**.

### 4. Probar el Widget de Chat Localmente
1. Ve al listado de Tenants en el Panel Admin y **copia el ID** del bot que acabas de crear (ej: `cmrp9ikcv0000...`).
2. Crea un archivo HTML local de pruebas (ej: `prueba.html`) en tu computadora con este contenido:
   ```html
   <!DOCTYPE html>
   <html lang="es">
   <head>
       <meta charset="UTF-8">
       <title>Prueba de Chatbot</title>
   </head>
   <body>
       <h1>Página de Pruebas del Chatbot</h1>
       
       <!-- Script del widget del chatbot -->
       <script 
         src="http://localhost:3000/widget.js" 
         data-tenant="ID_DE_TU_BOT"
       ></script>
   </body>
   </html>
   ```
3. Reemplaza `ID_DE_TU_BOT` con el ID copiado y abre el archivo en tu navegador. 
4. El chat aparecerá flotando listo para conversar y consultar tus productos reales.

---

## ⚡ Optimizaciones y Guardrails Integrados

* **Limpieza de Tokens (Anti-Explosión de TPM):** Para evitar errores de límite de tokens (TPM/Rate Limits) en proveedores en la nube como Groq, el backend filtra automáticamente descripciones kilométricas y remueve imágenes codificadas en `base64` antes de enviar el historial al LLM. Las imágenes se envían intactas solo al widget web.
* **Resolución Difusa de Categorías:** El chatbot traduce dinámicamente nombres legibles de categorías (ej: `"Equipos de Computación"`) a sus respectivos IDs en caliente, permitiendo búsquedas relajadas y flexibles.
* **Retrocompatibilidad de Contraseñas:** En la página de edición de bot, los passwords y keys se muestran vacíos por seguridad. El backend realiza un merge inteligente conservando las contraseñas previas si no se editan, permitiendo actualizar URLs u otros campos de conexión sin tener que re-escribir las claves secretas.
* **Bypass de Red en Docker:** Al conectar bases de datos que corren directamente en tu máquina local host en desarrollo, utiliza `host.docker.internal` en el campo Host en lugar de `localhost` para permitir que el contenedor de Docker pueda comunicarse con el host.
