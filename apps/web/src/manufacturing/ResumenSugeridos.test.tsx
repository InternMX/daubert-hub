import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { crearIncidencia } from './incidencias';
import { IncidenciasProvider, ResumenIncidencias } from './IncidenciaViews';
import type { IncidenciasContexto } from './incidenciasNavegacion';

const base = (over: Partial<IncidenciasContexto>): IncidenciasContexto => ({ lista: [], visible: () => true, valores: () => '', reconocidas: {}, reconocer: () => undefined, deshacer: () => undefined, validado: false, reveladas: new Set(), revelar: () => undefined, revision: 'vigente', ...over });
const falta = crearIncidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: ['ancho'], seccion: 'medidas', mensaje: 'Falta ancho.' });
const invalida = crearIncidencia({ codigo: 'VALOR_INVALIDO', nivel: 'ERROR', campos: ['largo'], seccion: 'medidas', mensaje: 'El largo debe ser un número mayor que cero.' });
const contradiccion = crearIncidencia({ codigo: 'TITULO_DESCRIPCION_DISTINTOS', nivel: 'CONTRADICCION', campos: ['calibre'], seccion: 'medidas', mensaje: 'Calibre distinto en Title y Description.' });

function montar(ctx: IncidenciasContexto) { return render(<IncidenciasProvider value={ctx}><ResumenIncidencias lista={ctx.lista} ctx={ctx} /></IncidenciasProvider>); }

describe('Revisión del borrador · cuatro categorías distintas', () => {
  it('muestra «por completar», «sugeridos por revisar», contradicciones y errores reales por separado', () => {
    montar(base({ lista: [falta, invalida, contradiccion], sugeridos: 3 }));
    expect(screen.getByTestId('resumen-FALTANTES')).toHaveTextContent('1 por completar');
    expect(screen.getByTestId('resumen-SUGERIDOS')).toHaveTextContent('3 sugeridos por revisar');
    expect(screen.getByTestId('resumen-CONTRADICCION')).toHaveTextContent('1 contradicción');
    expect(screen.getByTestId('resumen-ERROR')).toHaveTextContent('1 error');                         // solo el valor inválido: la falta no es un «error»
  });

  it('nueve datos por completar ya no se presentan como «9 errores»', () => {
    const nueve = Array.from({ length: 9 }, (_, i) => crearIncidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: [`campo${i}` as never], seccion: 'datos', mensaje: `Falta ${i}.` }));
    montar(base({ lista: nueve }));
    expect(screen.getByTestId('resumen-FALTANTES')).toHaveTextContent('9 por completar');
    expect(screen.queryByTestId('resumen-ERROR')).toBeNull();
    expect(screen.queryByText(/errores/)).toBeNull();
  });

  it('sin sugeridos ni incidencias no hay chips de más; un solo sugerido usa el singular', () => {
    const { unmount } = montar(base({}));
    expect(screen.queryByTestId('resumen-SUGERIDOS')).toBeNull();
    expect(screen.getByTestId('resumen-vacio')).toBeInTheDocument();
    unmount();
    montar(base({ sugeridos: 1 }));
    expect(screen.getByTestId('resumen-SUGERIDOS')).toHaveTextContent('1 sugerido por revisar');
  });
});
