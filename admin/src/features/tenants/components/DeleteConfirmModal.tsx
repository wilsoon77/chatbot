import './DeleteConfirmModal.css';

interface DeleteConfirmModalProps {
  tenantName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function DeleteConfirmModal({ tenantName, onConfirm, onCancel, loading }: DeleteConfirmModalProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-icon">⚠️</div>
        <h2 className="modal-title">¿Deseas eliminar este tenant?</h2>
        <p className="modal-body">
          Estás a punto de eliminar <strong>{tenantName}</strong>.<br />
          Esta acción no se puede deshacer.
        </p>
        <div className="modal-actions">
          <button className="modal-btn modal-btn--cancel" onClick={onCancel} disabled={loading}>
            Cancelar
          </button>
          <button className="modal-btn modal-btn--delete" onClick={onConfirm} disabled={loading}>
            {loading ? 'Eliminando...' : 'Sí, eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}
