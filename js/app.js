(() => {
  'use strict';

  const CLAVE = 'controlBoveda.v2';
  const CLAVE_V1 = 'registroCaja.v1';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const dinero = n => (n < 0 ? '−' : '') + 'S/ ' + Math.abs(Number(n) || 0).toFixed(2);
  const pad = n => String(n).padStart(2, '0');
  const claveFecha = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const aFecha = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

  // ---------- Almacenamiento ----------
  // estado = { saldoInicial: '', dias: { 'YYYY-MM-DD': registro } }
  // registro = { izipay, tipo: 'ganancia'|'perdida', monto, incremento ('' = automático), movimientos: [{tipo, concepto, monto}] }
  let estado = { saldoInicial: '', dias: {} };
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE));
    if (g && g.dias) estado = g;
    else migrarV1();
  } catch { /* sin almacenamiento */ }

  function migrarV1() {
    let v1;
    try { v1 = JSON.parse(localStorage.getItem(CLAVE_V1)); } catch { return; }
    if (!v1) return;
    for (const [f, r] of Object.entries(v1)) {
      const neto = num(r.ganancia) - num(r.perdida);
      const inc = num(r.reposicionExterno);
      estado.dias[f] = {
        izipay: r.izipay || '',
        tipo: neto < 0 ? 'perdida' : 'ganancia',
        monto: neto ? String(Math.abs(neto)) : '',
        incremento: inc ? String(inc) : '',
        movimientos: r.movimientos || [],
      };
    }
    guardar();
  }

  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch { /* sin almacenamiento */ }
  }

  const vacio = r => !r || (!num(r.izipay) && !num(r.monto) && r.incremento === '' &&
    !(r.movimientos || []).some(m => num(m.monto) || m.concepto));

  // ---------- Cálculo de la bóveda (en orden cronológico) ----------
  // Ganancia → entra a bóveda.
  // Pérdida → se saca de bóveda para reponer caja (reposición a caja = pérdida).
  // Si la bóveda no alcanza, lo que falta entra como incremento externo (automático
  // salvo que se escriba un monto a mano).
  // Gastos y retiros salen de bóveda.
  function calcular() {
    const res = {};
    let saldo = num(estado.saldoInicial);
    for (const f of Object.keys(estado.dias).sort()) {
      const r = estado.dias[f];
      const inicio = saldo;
      const monto = num(r.monto);
      const ganancia = r.tipo === 'ganancia' ? monto : 0;
      const perdida = r.tipo === 'perdida' ? monto : 0;
      saldo += ganancia;
      const faltante = Math.max(0, perdida - Math.max(0, saldo));
      const incremento = r.incremento === '' || r.incremento == null ? faltante : num(r.incremento);
      saldo += incremento - perdida;
      const movs = r.movimientos || [];
      const gastos = movs.filter(m => m.tipo === 'gasto').reduce((a, m) => a + num(m.monto), 0);
      const retiros = movs.filter(m => m.tipo === 'retiro').reduce((a, m) => a + num(m.monto), 0);
      saldo -= gastos + retiros;
      res[f] = {
        inicio, fin: saldo, izipay: num(r.izipay), ganancia, perdida,
        reposicion: perdida, faltante, incremento, auto: r.incremento === '' || r.incremento == null,
        gastos, retiros,
      };
    }
    return { dias: res, saldo };
  }

  // Saldo de bóveda antes de una fecha sin datos (para mostrarlo en días nuevos)
  function saldoAntesDe(fecha, calc) {
    let s = num(estado.saldoInicial);
    for (const f of Object.keys(calc.dias).sort()) {
      if (f >= fecha) break;
      s = calc.dias[f].fin;
    }
    return s;
  }

  // ---------- Estado de vista ----------
  const hoy = new Date();
  const claveHoy = claveFecha(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  let anio = hoy.getFullYear();
  let mes = hoy.getMonth();
  const seleccion = new Set([claveHoy]);

  const fmtMes = new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' });
  const fmtDia = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });

  // ---------- Calendario ----------
  function renderCalendario() {
    $('#mesTitulo').textContent = fmtMes.format(new Date(anio, mes, 1));
    const g = $('#grilla');
    g.innerHTML = '';
    const desfase = (new Date(anio, mes, 1).getDay() + 6) % 7; // lunes primero
    for (let i = 0; i < desfase; i++) g.appendChild(document.createElement('span'));
    const diasMes = new Date(anio, mes + 1, 0).getDate();
    for (let d = 1; d <= diasMes; d++) {
      const f = claveFecha(anio, mes, d);
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = d;
      b.dataset.fecha = f;
      b.setAttribute('aria-pressed', seleccion.has(f));
      b.classList.toggle('sel', seleccion.has(f));
      b.classList.toggle('dato', !vacio(estado.dias[f]));
      b.classList.toggle('hoy', f === claveHoy);
      b.addEventListener('click', () => {
        if (seleccion.has(f)) seleccion.delete(f); else seleccion.add(f);
        renderCalendario();
        renderFormularios(f);
      });
      g.appendChild(b);
    }
  }

  // ---------- Formularios de los días seleccionados ----------
  function renderFormularios(enfocar) {
    const cont = $('#formularios');
    const existentes = new Map($$('.dia', cont).map(el => [el.dataset.fecha, el]));
    const orden = [...seleccion].sort();
    for (const [f, el] of existentes) if (!seleccion.has(f)) el.remove();
    orden.forEach(f => {
      const el = existentes.get(f) || crearDia(f);
      cont.appendChild(el); // mantiene el orden
    });
    if (!orden.length) {
      cont.innerHTML = '<p class="vacio">Selecciona uno o más días en el calendario.</p>';
    } else {
      const aviso = $('.vacio', cont);
      if (aviso) aviso.remove();
    }
    actualizarCalculos();
    if (enfocar && seleccion.has(enfocar)) {
      const el = cont.querySelector(`[data-fecha="${enfocar}"]`);
      if (el && !existentes.has(enfocar)) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  let uid = 0;
  function crearDia(fecha) {
    const el = $('#tplDia').content.firstElementChild.cloneNode(true);
    el.dataset.fecha = fecha;
    { const t = fmtDia.format(aFecha(fecha)); $('.fecha', el).textContent = t[0].toUpperCase() + t.slice(1); }
    if (fecha === claveHoy) el.classList.add('hoy');

    const form = $('.formDia', el);
    const nombreRadio = 'gp' + (++uid);
    $$('.seg input', el).forEach(i => { i.name = nombreRadio; });

    const r = estado.dias[fecha] || {};
    form.elements.izipay.value = r.izipay ?? '';
    form.elements.monto.value = r.monto ?? '';
    form.elements.incremento.value = r.incremento ?? '';
    $(`.seg input[value="${r.tipo || 'ganancia'}"]`, el).checked = true;
    (r.movimientos || []).forEach(m => agregarMov(el, m));

    form.addEventListener('input', () => leerYGuardar(el));
    form.addEventListener('change', () => leerYGuardar(el));
    form.addEventListener('submit', e => e.preventDefault());
    $('.agregar', el).addEventListener('click', () => {
      const li = agregarMov(el);
      $('[name=concepto]', li).focus();
    });
    $('.cerrar', el).addEventListener('click', () => {
      seleccion.delete(fecha);
      renderCalendario();
      renderFormularios();
    });
    $('.borrar', el).addEventListener('click', () => {
      if (!confirm('¿Borrar todos los datos de este día?')) return;
      delete estado.dias[fecha];
      guardar();
      el.remove();
      renderCalendario();
      renderFormularios();
    });
    return el;
  }

  function agregarMov(el, m = { tipo: 'gasto', concepto: '', monto: '' }) {
    const li = $('#tplMov').content.firstElementChild.cloneNode(true);
    $('[name=tipo]', li).value = m.tipo;
    $('[name=concepto]', li).value = m.concepto;
    $('[name=montoMov]', li).value = m.monto;
    $('.quitar', li).addEventListener('click', () => { li.remove(); leerYGuardar(el); });
    $('.movs', el).appendChild(li);
    return li;
  }

  function leerYGuardar(el) {
    const form = $('.formDia', el);
    const r = {
      izipay: form.elements.izipay.value,
      tipo: $('.seg input:checked', el).value,
      monto: form.elements.monto.value,
      incremento: form.elements.incremento.value,
      movimientos: $$('.mov', el).map(li => ({
        tipo: $('[name=tipo]', li).value,
        concepto: $('[name=concepto]', li).value.trim(),
        monto: $('[name=montoMov]', li).value,
      })),
    };
    const f = el.dataset.fecha;
    const antes = !vacio(estado.dias[f]);
    if (vacio(r)) delete estado.dias[f];
    else estado.dias[f] = r;
    guardar();
    if (antes !== !vacio(r)) renderCalendario();
    actualizarCalculos();
  }

  // ---------- Recalcular todo lo mostrado ----------
  function actualizarCalculos() {
    const calc = calcular();
    const s = $('#saldoActual');
    s.textContent = dinero(calc.saldo);
    s.className = calc.saldo < 0 ? 'neg' : '';

    $$('#formularios .dia').forEach(el => {
      const f = el.dataset.fecha;
      const c = calc.dias[f];
      const inicio = c ? c.inicio : saldoAntesDe(f, calc);
      const t = c || { inicio, fin: inicio, izipay: 0, ganancia: 0, perdida: 0, reposicion: 0, faltante: 0, incremento: 0, auto: true, gastos: 0, retiros: 0 };
      const esPerdida = $('.seg input:checked', el).value === 'perdida';

      $('.nota-gp', el).textContent = esPerdida
        ? 'La pérdida se saca de bóveda para completar la caja.'
        : 'La ganancia ingresa a bóveda.';
      $('.reposicion', el).textContent = dinero(t.reposicion);

      const inc = $('[name=incremento]', el);
      inc.placeholder = t.faltante.toFixed(2);
      $('.nota-inc', el).textContent = t.auto
        ? (t.faltante > 0
          ? `Automático: faltaban ${dinero(t.faltante)} en bóveda para reponer la caja.`
          : 'Automático: la bóveda alcanzó, no hace falta incremento externo.')
        : `Monto ingresado a mano${t.faltante > 0 ? ` (faltaban ${dinero(t.faltante)})` : ''}. Déjalo vacío para calcularlo solo.`;

      $('.totales', el).innerHTML = `
        <div><span>Bóveda al inicio del día</span><span>${dinero(t.inicio)}</span></div>
        <div><span>+ Ganancia</span><span class="pos">${dinero(t.ganancia)}</span></div>
        <div><span>− Reposición a caja (pérdida)</span><span class="neg">${dinero(t.reposicion)}</span></div>
        <div><span>+ Incremento externo</span><span class="pos">${dinero(t.incremento)}</span></div>
        <div><span>− Gastos y retiros</span><span class="neg">${dinero(t.gastos + t.retiros)}</span></div>
        <div class="final"><span>Bóveda al cierre</span><span class="${t.fin < 0 ? 'neg' : ''}">${dinero(t.fin)}</span></div>
        <div class="aparte"><span>Izipay (venta del día)</span><span>${dinero(t.izipay)}</span></div>`;
    });

    renderResumen(calc);
  }

  function fechasDelMes() {
    const pref = `${anio}-${pad(mes + 1)}-`;
    return Object.keys(estado.dias).filter(k => k.startsWith(pref)).sort();
  }

  function renderResumen(calc) {
    const fechas = fechasDelMes();
    const s = { izipay: 0, ganancia: 0, perdida: 0, incremento: 0, gastos: 0, retiros: 0 };
    fechas.forEach(f => Object.keys(s).forEach(k => { s[k] += calc.dias[f][k]; }));
    const primer = claveFecha(anio, mes, 1);
    const inicio = saldoAntesDe(primer, calc);
    const fin = fechas.length ? calc.dias[fechas[fechas.length - 1]].fin : inicio;
    const item = (lbl, v, cls = '') => `<div><small>${lbl}</small><b class="${cls}">${dinero(v)}</b></div>`;
    $('#resumenMes').innerHTML =
      item('Ventas Izipay', s.izipay) +
      item('Ganancias', s.ganancia, 'pos') +
      item('Pérdidas / reposición a caja', s.perdida, 'neg') +
      item('Incremento externo', s.incremento) +
      item('Gastos', s.gastos, 'neg') +
      item('Retiros', s.retiros, 'neg') +
      item('Bóveda al inicio del mes', inicio) +
      item('Bóveda al cierre del mes', fin, fin < 0 ? 'neg' : '');
  }

  // ---------- Exportar ----------
  function exportarCSV() {
    const calc = calcular();
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = [['Fecha', 'Izipay', 'Ganancia', 'Pérdida', 'Reposición a caja', 'Incremento externo',
      'Gastos', 'Retiros', 'Detalle gastos/retiros', 'Bóveda inicio', 'Bóveda cierre']];
    for (const f of fechasDelMes()) {
      const c = calc.dias[f];
      const detalle = (estado.dias[f].movimientos || [])
        .map(m => `${m.tipo}: ${m.concepto} ${num(m.monto).toFixed(2)}`).join('; ');
      filas.push([f, c.izipay, c.ganancia, c.perdida, c.reposicion, c.incremento, c.gastos, c.retiros,
        detalle, c.inicio, c.fin].map(v => typeof v === 'number' ? v.toFixed(2) : v));
    }
    const csv = '﻿' + filas.map(fila => fila.map(esc).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `boveda-${anio}-${pad(mes + 1)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Eventos ----------
  $('#saldoInicial').value = estado.saldoInicial ?? '';
  $('#saldoInicial').addEventListener('input', e => {
    estado.saldoInicial = e.target.value;
    guardar();
    actualizarCalculos();
  });
  $('#prev').addEventListener('click', () => { if (--mes < 0) { mes = 11; anio--; } renderCalendario(); actualizarCalculos(); });
  $('#next').addEventListener('click', () => { if (++mes > 11) { mes = 0; anio++; } renderCalendario(); actualizarCalculos(); });
  $('#limpiar').addEventListener('click', () => { seleccion.clear(); renderCalendario(); renderFormularios(); });
  $('#exportar').addEventListener('click', exportarCSV);

  renderCalendario();
  renderFormularios();
})();
