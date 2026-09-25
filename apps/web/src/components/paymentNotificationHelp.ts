// Help texts for the Payment Notifications setup screens (InfoTooltip content), kept in one place so the
// wording is consistent and tests can assert it.
export const PRIMARY_EMAIL_HELP = 'Indica si este es el correo principal del contacto. Es independiente de las Notificaciones de Pago; un correo puede ser principal y no recibir notificaciones de pago, o viceversa.';
export const PAYMENT_NOTIFICATIONS_HELP = 'Configura si este correo participará en los avisos de pago. Esta configuración es independiente de que sea el correo principal del contacto.';
export const RECIPIENT_TYPE_HELP = 'PARA: destinatario principal del correo.\nCC: recibe una copia visible para los demás destinatarios.\nCCO: recibe una copia oculta.\nPara mantener activas las Notificaciones de Pago, la empresa debe tener al menos un destinatario PARA activo.';
export const DROPBOX_PATH_HELP = 'Ruta relativa dentro del Dropbox de Daubert que utilizará esta empresa. No incluyas una ruta absoluta, letra de unidad ni el prefijo Dropbox.';
export const DROPBOX_SUGGESTION_HELP = "El Hub calcula esta ruta usando el tipo de empresa y su nombre comercial. Es solo una sugerencia: no comprueba si la carpeta existe en Dropbox, no crea carpetas y no modifica la ruta actual hasta que selecciones 'Usar sugerencia' y guardes los cambios.";
export const PROCESSES_RECEIPTS_HELP = 'Indica que esta empresa puede ser considerada al procesar comprobantes de pago. Esta opción no activa por sí sola la generación de notificaciones.';
export const GENERATE_DRAFTS_HELP = 'Permite que la automatización genere las notificaciones de pago para esta empresa. Para activarlo se requiere una ruta Dropbox, procesamiento habilitado y al menos un destinatario PARA activo.';
export const CALCULATED_DESTINATION_HELP = 'Ruta que utilizará la automatización para organizar los comprobantes. Se genera automáticamente a partir de la Ruta Dropbox y no se edita manualmente.';
