// ESC/POS image formats follow Epson's public command reference:
// https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_asterisk.html
// https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lv_0.html
// Format correctness does not certify a particular printer's firmware or paper output.
const ESC=0x1b,GS=0x1d;
const paper80=value=>String(value || '').trim().toLowerCase()==='80mm';

export function logoModeForPaper(mode,paperSize='58mm') {
    if(mode===undefined || mode===null || mode==='' || mode==='auto')return paper80(paperSize)?'raster':'esc-star24';
    if(mode==='compatible' || mode==='esc-star24')return 'esc-star24';
    if(mode==='raster' || mode==='none')return mode;
    throw Error('Choose Compatible, Raster or Text only for receipt logos.');
}

export function printerLogoDimensions({width,height,scaleWidth=1,scaleHeight=1,paperSize='58mm',mode}={}) {
    const selected=logoModeForPaper(mode,paperSize);
    if(selected==='none')return {width:0,height:0};
    if(!Number.isFinite(width) || !Number.isFinite(height) || width<=0 || height<=0)throw Error('The receipt logo has no usable image dimensions.');
    const scale=value=>Math.max(.25,Math.min(3,Number(value)||1));
    const widthScale=scale(scaleWidth),heightScale=scale(scaleHeight),wide=paper80(paperSize);
    const expanded=selected==='esc-star24' && (widthScale>1 || heightScale>1);
    const maxWidth=wide?576:expanded?320:192,maxHeight=wide?480:expanded?384:240,normalWidth=wide?320:160;
    // Both controls scale the original base image. Applying height to an
    // already width-scaled image made equal scales distort and shrink logos.
    const requestedWidth=normalWidth*widthScale,requestedHeight=height/width*normalWidth*heightScale;
    // Height is an integer pixel count: fractional height below the next
    // rounding boundary still fits. This avoids a width jump at a full cap.
    const fit=Math.min(1,maxWidth/requestedWidth,(maxHeight+.5-1e-9)/requestedHeight);
    let targetWidth=Math.max(8,Math.floor(requestedWidth*fit/8)*8);
    if(widthScale===heightScale && widthScale<=1){
        // Released defaults rounded height before fitting. Preserve that exact
        // default envelope for unchanged or equally reduced settings; larger
        // equal scales can then grow without a rounding discontinuity at 1x.
        const defaultHeight=Math.max(1,Math.round(height/width*normalWidth));
        const defaultLimit=wide?480:240;
        const defaultWidth=defaultHeight>defaultLimit?Math.max(8,Math.floor(normalWidth*defaultLimit/defaultHeight/8)*8):normalWidth;
        targetWidth=Math.min(targetWidth,defaultWidth);
    }
    // Reuse the requested aspect after byte-width quantization. An extremely
    // narrow image cannot preserve its aspect below the minimum eight dots.
    const targetHeight=Math.max(1,Math.min(maxHeight,Math.round(requestedHeight/requestedWidth*targetWidth)));
    return {width:targetWidth,height:targetHeight};
}

function imageInput({width,height,pixels,threshold}) {
    if(!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width<=0 || width>576 || height<=0 || height>480)throw Error('Receipt logo pixels exceed the supported image size.');
    if(!Number.isSafeInteger(threshold) || threshold<0 || threshold>255)throw Error('The receipt logo threshold must be a byte value.');
    if(!pixels || pixels.length!==width*height*4 || !(Array.isArray(pixels) || ArrayBuffer.isView(pixels) && pixels.BYTES_PER_ELEMENT===1))throw Error('Receipt logo pixels must contain one RGBA value per pixel.');
    if(Array.isArray(pixels) && pixels.some(value=>!Number.isSafeInteger(value)||value<0||value>255))throw Error('Receipt logo RGBA values must be bytes.');
    // Composite against white using exact integer arithmetic. Transparent dark
    // pixels must not become an opaque black background or extra head heating.
    return (x,y)=>{
        if(x>=width || y>=height)return false;
        const at=(y*width+x)*4,alpha=pixels[at+3];
        const luminance=2126*pixels[at]+7152*pixels[at+1]+722*pixels[at+2];
        return luminance*alpha+2550000*(255-alpha)<threshold*10000*255;
    };
}

function packet(parts,pauses) {
    const bytes=new Uint8Array(parts.reduce((total,part)=>total+part.length,0));let offset=0;
    for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    // Explicit image progress offsets let transport pace large bodies without
    // inserting commands. Compatible offsets end full bands; raster offsets
    // end complete rows inside its one command. Never scan pixel bytes.
    Object.defineProperty(bytes,'pauseAfterBytes',{value:Object.freeze([...pauses]),enumerable:false,writable:false});
    return bytes;
}

export function encodePrinterLogo({width,height,pixels,mode='esc-star24',threshold=128}={}) {
    const selected=logoModeForPaper(mode);
    if(selected==='none')return packet([],[]);
    const black=imageInput({width,height,pixels,threshold}),parts=[],pauses=[];let size=0;
    const append=bytes=>{parts.push(bytes);size+=bytes.length;};
    append(Uint8Array.from([ESC,0x61,1]));
    if(selected==='esc-star24'){
        append(Uint8Array.from([ESC,0x33,24]));
        for(let top=0;top<height;top+=24){
            const band=new Uint8Array(5+width*3+1);
            band.set([ESC,0x2a,33,width&255,width>>8],0);
            for(let x=0;x<width;x++)for(let group=0;group<3;group++){
                let bits=0;for(let bit=0;bit<8;bit++)if(black(x,top+group*8+bit))bits|=1<<(7-bit);
                band[5+x*3+group]=bits;
            }
            band[band.length-1]=0x0a;append(band);pauses.push(size);
        }
    }else{
        const rowBytes=Math.ceil(width/8),image=new Uint8Array(8+rowBytes*height),bodyStart=size+8;
        image.set([GS,0x76,0x30,0,rowBytes&255,rowBytes>>8,height&255,height>>8],0);
        for(let y=0;y<height;y++){
            for(let byte=0;byte<rowBytes;byte++){
                let bits=0;for(let bit=0;bit<8;bit++)if(black(byte*8+bit,y))bits|=1<<(7-bit);
                image[8+y*rowBytes+byte]=bits;
            }
            if((y+1)%16===0 || y===height-1)pauses.push(bodyStart+(y+1)*rowBytes);
        }
        append(image);
    }
    append(Uint8Array.from([ESC,0x32,ESC,0x61,0]));
    return packet(parts,pauses);
}

export function loadPrinterLogo(source,{paperSize='58mm',scaleWidth=1,scaleHeight=1,mode,threshold=128,timeoutMs=8000,
    imageFactory=()=>new Image(),canvasFactory=()=>document.createElement('canvas'),
    schedule=(fn,delay)=>globalThis.setTimeout(fn,delay),cancel=id=>globalThis.clearTimeout(id)}={}) {
    let selected;
    try{selected=logoModeForPaper(mode,paperSize);}catch(error){return Promise.reject(error);}
    if(selected==='none')return Promise.resolve(packet([],[]));
    if(typeof source!=='string' || !source.trim())return Promise.reject(Error('Choose a receipt logo image before testing it.'));
    if(!Number.isFinite(timeoutMs) || timeoutMs<=0 || timeoutMs>8000)return Promise.reject(Error('Receipt logo loading must have a timeout of at most 8 seconds.'));
    return new Promise((resolve,reject)=>{
        let image,timer=null,done=false;
        const finish=(error,result)=>{
            if(done)return;done=true;
            if(timer!==null){try{cancel(timer);}catch{/* Preserve the original completion even if a custom timer cleanup fails. */}}
            if(image){image.onload=null;image.onerror=null;}
            error?reject(error):resolve(result);
        };
        try{
            timer=schedule(()=>finish(Error('The receipt logo did not load within 8 seconds. Use Text only or replace the logo image.')),timeoutMs);
            image=imageFactory();
            if(!image)throw Error('This browser cannot load the receipt logo.');
            image.onload=()=>{
                if(done)return;
                try{
                    const dimensions=printerLogoDimensions({width:image.naturalWidth || image.width,height:image.naturalHeight || image.height,scaleWidth,scaleHeight,paperSize,mode:selected});
                    const canvas=canvasFactory();if(!canvas)throw Error('This browser cannot prepare the receipt logo.');
                    canvas.width=dimensions.width;canvas.height=dimensions.height;
                    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('This browser cannot prepare the receipt logo.');
                    context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
                    const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
                    finish(null,encodePrinterLogo({...dimensions,pixels,mode:selected,threshold}));
                }catch(error){finish(Error('The receipt logo could not be prepared. Use Text only or replace the image. '+(error?.message || '')));}
            };
            image.onerror=()=>finish(Error('The receipt logo image could not be loaded. Use Text only or replace it.'));
            // Uploaded data URLs work without CORS. Remote legacy images must
            // grant anonymous canvas access; a tainted image fails explicitly.
            if(/^https?:/i.test(source))image.crossOrigin='anonymous';
            image.src=source;
        }catch(error){finish(error instanceof Error?error:Error('The receipt logo could not be loaded.'));}
    });
}
