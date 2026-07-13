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
