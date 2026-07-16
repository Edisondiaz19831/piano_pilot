# Visor musical con biblioteca SQLite

Esta versión permite guardar partituras MusicXML/MXL en una biblioteca local
y elegirlas posteriormente sin volver a subirlas.

## Funciones

- Biblioteca persistente en SQLite.
- Carga de `.musicxml`, `.xml` y `.mxl`.
- Campos de título, número de lección, número de ejercicio y observaciones.
- Orden automático por lección y ejercicio.
- Eliminación de partituras.
- Visor pasado, presente y futuro.
- Escala uniforme para conservar digitaciones.
- Tempo, cuenta previa, repetición y metrónomo suave.
- Acceso desde tablet en la misma red.

## Instalación

```bash
conda create -n visor_partitura python=3.12 -y
conda activate visor_partitura
pip install -r requirements.txt
python app.py
```

Abra:

```text
http://127.0.0.1:5000
```

La base de datos se crea automáticamente en:

```text
instance/biblioteca_musical.db
```

Los archivos se guardan en:

```text
uploads/
```

## Copia de seguridad

Para respaldar toda la biblioteca, copie juntos:

- `instance/biblioteca_musical.db`
- la carpeta `uploads`


## Transiciones fluidas

Esta versión guarda cada compás renderizado en una caché SVG y precarga los
compases siguientes mientras se reproduce el actual. De esa manera, el
metrónomo no tiene que esperar a OpenSheetMusicDisplay en cada transición.


## Transposición

El visor permite transponer temporalmente cada ejercicio entre −12 y +12
semitonos. También permite escoger escritura automática, con sostenidos o con
bemoles.

La transposición:

- modifica notas, octavas y armaduras dentro del navegador;
- conserva ritmo, digitaciones, articulaciones y dinámicas;
- actualiza símbolos de acordes básicos cuando existen;
- no modifica el archivo original almacenado en la biblioteca.

En ejercicios con digitación fija, la numeración se conserva aunque una nueva
tonalidad pueda requerir otra solución técnica.


## Ajuste para tablet

Se conserva visible el comienzo de todos los compases, incluso cuando contienen
muchas corcheas o son más anchos que la tarjeta:

- alineación desde la izquierda;
- margen antes de la llave y la primera nota;
- retorno automático al inicio horizontal en cada transición;
- presente más ancho en tablet horizontal;
- disposición apilada en tablet vertical;
- conservación de base de datos, biblioteca, metrónomo, caché y transposición.


## Ajuste automático del compás presente

El panel central conserva una altura de 300 px cuando el compás cabe. Si un
compás es más ancho que el espacio disponible en una tablet, se reduce
proporcionalmente hasta mostrarlo completo, sin deformar notas ni digitaciones.
Los paneles pasado y futuro mantienen desplazamiento horizontal.


## Encaje completo del compás

Cada panel calcula ahora la escala del SVG usando simultáneamente el ancho y
el alto disponibles. El compás se reduce proporcionalmente hasta caber
completo, sin deformarse, sin barras horizontales y sin perder digitaciones.


## Corrección de SVG sin viewBox

Algunas partituras generadas por OpenSheetMusicDisplay no incluyen `viewBox`.
La aplicación obtiene ahora el tamaño natural desde `viewBox`, atributos
`width/height`, propiedades SVG o `getBBox`. Si ninguno está disponible,
mantiene las dimensiones originales para impedir que la partitura desaparezca.


## Corrección de caché

Se restauraron `buildMeasureCache` y `showCachedMeasure`, y se añadió versionado de los archivos estáticos para evitar JavaScript antiguo en tablet o Render.


## Guía con nombres de notas

La barra de transposición incluye la opción **Mostrar nombres de notas**.

- Muestra nombres en español: Do, Re, Mi, Fa, Sol, La y Si.
- Respeta sostenidos, bemoles y alteraciones dobles.
- En acordes combina las alturas en una sola guía, por ejemplo Do–Mi–Sol.
- Al transponer, los nombres se recalculan con las nuevas alturas.
- Las etiquetas son temporales y no modifican el archivo guardado.


## Cifrado de notas

La guía utiliza cifrado anglosajón:

- C, D, E, F, G, A y B.
- Las alteraciones se muestran como C♯, E♭, F𝄪, etc.
- Los acordes se muestran combinados, por ejemplo C–E–G.
- El cifrado se recalcula automáticamente al transponer.
