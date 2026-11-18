import fitz, json, sys, os, glob
host, cont = sys.argv[1], sys.argv[2]
def words(p):
    with fitz.open(p) as d:
        out=[]; fonts=set()
        for i,pg in enumerate(d,1):
            for x0,y0,x1,y1,t,*_ in pg.get_text("words"): out.append((i,round(x0,1),round(y0,1),round(x1,1),t))
            for f in pg.get_fonts(): fonts.add(f[3])
        return len(d), out, fonts, d[0].rect
for f in sorted(glob.glob(os.path.join(host,'*.pdf'))):
    n=os.path.basename(f); a=words(f); b=words(os.path.join(cont,n))
    same_text = [w[4] for w in a[1]]==[w[4] for w in b[1]]
    maxdx=maxdy=0; moved=0
    if len(a[1])==len(b[1]):
        for w,v in zip(a[1],b[1]):
            dx=abs(w[1]-v[1]); dy=abs(w[2]-v[2]); maxdx=max(maxdx,dx); maxdy=max(maxdy,dy)
            if dx>2 or dy>2: moved+=1
    print(f"{n:24} pág host/cont {a[0]}/{b[0]} | palabras {len(a[1])}/{len(b[1])} | mismo texto {same_text} | desv.máx x={maxdx:.1f} y={maxdy:.1f} pt | >2pt: {moved} | tamaño {a[3].width:.0f}x{a[3].height:.0f}/{b[3].width:.0f}x{b[3].height:.0f}")
    print("   fuentes host:", sorted(a[2]), "| contenedor:", sorted(b[2]))
