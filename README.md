# Control Bóveda de Casino

Abre `index.html` en el navegador (funciona también en el celular).

## Uso
1. **Seleccionar fecha:** en el calendario toca uno o más días; se abre un formulario por cada día.
2. **Izipay:** venta del día (S/). Se registra aparte, no mueve la bóveda.
3. **Ganancia o pérdida en caja:**
   - Ganancia → ingresa a bóveda.
   - Pérdida → se saca de bóveda para completar la caja.
4. **Reposición a caja:** se calcula sola (= la pérdida).
5. **Incremento externo:** si la bóveda no alcanza para reponer la caja, lo que falta se calcula solo
   como incremento externo. También puedes escribir el monto a mano (déjalo vacío para que vuelva a ser automático).
6. **Gastos o retiros:** salen de bóveda.

Arriba se ve el **saldo actual de bóveda** (empieza en el "saldo inicial" que configures).
Cada día muestra la bóveda al inicio y al cierre. Abajo hay un resumen del mes y exportación a CSV.

Los datos se guardan automáticamente en el navegador (localStorage), solo en ese dispositivo.
