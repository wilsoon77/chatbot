import { createRoot } from 'react-dom/client';
import App from './App.tsx';
// Cargar index.css como string en bruto (raw string) usando Vite ?inline
// Esto es obligatorio para poder inyectarlo dentro del Shadow DOM aislado
import styles from './index.css?inline';

class ChatbotWidget extends HTMLElement {
  connectedCallback() {
    // 1. Crear el Shadow Root
    const shadow = this.attachShadow({ mode: 'open' });

    // 2. Inyectar los estilos CSS específicos dentro del Shadow Root
    const styleTag = document.createElement('style');
    styleTag.textContent = styles;
    shadow.appendChild(styleTag);

    // 3. Crear el contenedor de montaje para React
    const container = document.createElement('div');
    container.id = 'chatbot-widget-mount';
    shadow.appendChild(container);

    // 4. Leer atributos configurados por el script/etiqueta del cliente
    const tenant = this.getAttribute('data-tenant') || 'demo';
    const color = this.getAttribute('data-color') || '#10b981';
    const botName = this.getAttribute('data-bot-name') || 'Asistente';
    const avatarUrl = this.getAttribute('data-avatar-url') || '';

    // 5. Montar y renderizar la aplicación de React
    const root = createRoot(container);
    root.render(
      <App
        tenant={tenant}
        color={color}
        botName={botName}
        avatarUrl={avatarUrl}
      />
    );
  }
}

// Registrar el Custom Element de forma segura
if (!customElements.get('chatbot-widget')) {
  customElements.define('chatbot-widget', ChatbotWidget);
}

// ─── Autoinserción del Widget ────────────────────────────────────────
// Si se carga mediante script, se inyecta automáticamente en el body.
// Esto permite el despliegue con una sola línea de script en cualquier web.
const currentScript = document.currentScript || document.querySelector('script[data-tenant]');
if (currentScript) {
  const tenant = currentScript.getAttribute('data-tenant') || 'demo';
  const color = currentScript.getAttribute('data-color') || '#10b981';
  const botName = currentScript.getAttribute('data-bot-name') || 'Asistente';
  const avatarUrl = currentScript.getAttribute('data-avatar-url') || '';

  // Crear la etiqueta del Custom Element e inyectarla
  const widgetElement = document.createElement('chatbot-widget');
  widgetElement.setAttribute('data-tenant', tenant);
  widgetElement.setAttribute('data-color', color);
  widgetElement.setAttribute('data-bot-name', botName);
  widgetElement.setAttribute('data-avatar-url', avatarUrl);

  document.body.appendChild(widgetElement);
}
