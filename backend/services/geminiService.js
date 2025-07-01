const { GoogleGenerativeAI } = require('@google/generative-ai');
const { exec } = require('child_process'); 
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');
//AIzaSyCLVtDvkzCVmjfkGZuxCDAytsCVfyCodN0
const genAI = new GoogleGenerativeAI('AIzaSyA12zKQqVl9VDqSJXJgB_VvkLJTMonhOlg'); 

async function convertPdfToImages(pdfPath) {
  try {
    const outputDir = path.join(path.dirname(pdfPath), 'temp_images');
    await fs.mkdir(outputDir, { recursive: true });

    const outputPrefix = path.join(outputDir, 'page');
    await execPromise(`gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=jpeg -r300 -dJPEGQ=100 -dFirstPage=1 -dLastPage=100 -sOutputFile="${outputPrefix}-%d.jpg" "${pdfPath}"`);

    const files = await fs.readdir(outputDir);
    const imageFiles = files.filter(file => file.endsWith('.jpg')).sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)[0]);
      const numB = parseInt(b.match(/\d+/)[0]);
      return numA - numB;
    });
    const images = [];

    for (const file of imageFiles) {
      const imagePath = path.join(outputDir, file);
      const imageBuffer = await fs.readFile(imagePath);
      images.push(imageBuffer.toString('base64'));
      await fs.unlink(imagePath);
    }

    await fs.rmdir(outputDir);

    return images;
  } catch (error) {
    console.error('Error converting PDF to images:', error);
    throw error;
  }
}

async function analyzeInvoiceImage(imageBase64) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `You are an expert in extracting product entries and key invoice details from invoice table images.Extract all the given details for each product in invoice.Never create nested objects. 
    THE VERY MOST CRITICAL: Number of products in invoice=Rows containing HSN/SAC number in invoice. MOST CRUCIAL NEVER skip any product from any invoice.even return null for any product you dont understand but never skip. From previous interations you commonly skipping products, never do that.  
STRICTLY return all the given values for each product in invoice.NEVER round off any data if invoice has 0.76 then don't convert it to 0.75.

**I. Core Extraction Targets:**

For each product row (identified by a HSN/SAC number):
* **HSNNumber**: From 'HSN/SAC' column (number).
* **Unit**: From 'UQC' column (string or null).
* **Quantity**: From 'Net Weight' column only (number, always present, small value). **CRITICAL**: Double-check for accuracy, especially with pen marks. Never round values.NEVER extract values from Gross Weight column ignore that column at all.
* **TaxableValue**: From 'Amount' column (number or null if empty). Calculate accurate digit count.
* **cgst**: From 'CGST' column (number or null). Null if empty or IGST is present.Dont Extract value from "TAX%" column.If TaxableValue is empty put null.
* **sgst**: From 'SGST' column (number or null). Null if empty or IGST is present.Dont Extract value from "TAX%" column.If TaxableValue is empty put null.
* **igst**: From 'IGST' column (number or null). Null if empty or CGST/SGST are present.Dont Extract value from "TAX%" column.If TaxableValue is empty put null.

For each product these are common values (ALWAYS extract only once for whole invoice then use same for all the products):
* **partyName**: Value next to 'Name' under 'BILLING ADDRESS' .MOST IMPORTANT can end with a comma,Only if there is comma then include the comma,There can be heavy pen marks on comma so extract comma if it is under the pen marks carefully.check just under 'Name' if theres other text then 'Address' means it is continuation of partyName put ' '(space) between.
* **VNo**: Value next to 'TAX INVOICE NO'. Format: 'SIR-JH-1-24-25' (manually prefix 'SIR-').REMEMBER TO Keep 'SIR-JH-Num-Num-Num' format only STRICTLY.
* **date**: Value next to 'Date'. Format: DD/MM/YYYY,ALWAYS maually convert to M/D/YY.
* **ProductName**: Return Whole Description column from top to bottom every single text/number in a single string by just putting space between.i dont want seperate string for each products just return whole description column from the Invoice.
* **grossnet**: From the provided invoice image, locate the 'Total' row at the very end of the main product table. Extract the numerical total value from the 'Gross Weight' column and the numerical total value from the 'Net Weight' column within this 'Total' row.MOST IMPORTANT There will be heavy pen marks on top these values, so take your time to distinguish actual numbers from pen marks.

**II. General Instructions & Critical Reminders:**

* **CRITICAL at end of name there can be comma and exactly on top of comma there can be pen marking then give your time and carefully extract comma.
* **ALWAYS REMEMBER if name is ending with - means name has not ended check just row after current row you will get remaining name keep '-' and include next row's name with a space between. eg. (Mr. Udaya Shankar Reddy Hardageri - HUF).
* **REMEMBER if name is long and going to next line then extract name from next line as well.
* **Independence**: Treat each invoice independently; do not be influenced by previous invoices.
* **grossnet as Array:** This directly addresses your request for an "array of integers" (interpreted as numerical values for precision) for the totals.Don't create new array for this field, just put it in the same object as other fields.Most Importantly distinguish actual numbers from pen marks.
* **Initial Scan**: First, identify all columns present and the number of product entries via HSN/SAC. Determine if 'IGST' or 'CGST/SGST' columns are present.
* **Pen Marks**: **ALWAYS** prioritize extraction time and care when data is near blue/black pen marks. Distinguish actual data from marks. This is especially true for 'Net Weight' and 'GNCheck' values.
* **Accuracy**: Never round off values; keep them as they are. If a value seems inaccurate, re-check the entire row.
* **Skipping**: Skip rows without a HSN/SAC number.
* **Output**: Return results as a valid JSON array of objects.

**III. Common Mistakes to Avoid (Past Issues):**

* **Row Misalignment**: Do not extract values (especially CGST, SGST, IGST) from incorrect rows.
* **Partial Extraction**: For 'Net Weight' (e.g., 0.760), extract the full accurate value (0.760, not 0.76 or 0.75).
* **Net Weight Extraction**: For 'Net Weigh' you commonly take Net Weight value from Gross Weight column.always extract values from net weight only.
* **Pen Mark Confusion (GNCheck)**: Be vigilant; pen marks often obscure 'GNCheck' values. Ensure you extract the *real* number, not the mark.
* **PartyName comma inclusion**: You do not include comma if pen mark is on top of comma. In this case always include comma.

**Example Table Structure:**

Qty | Description | HSN/SAC | UQC | Purity | Gross Weight | Net Weight | Amount | TAX% | CGST | TAX% | SGST | (or IGST instead of CGST/SGST) |

**Example of ProductName extraction**

Qty |     Description         | HSN/SAC |
Pair|    Gold Ornaments 18K-  | 711319  |  
    |       Ring with         |         |
    |                         |         |
    |                         |         |
    |                         |         |
    |    Diamonds QS M/P 7    | 711319  | 

For this you have to extract 'Gold Ornaments 18K-Ring with Diamonds QS M/P 7' whole Description at once by putting ' '(space) when going to next row.NEVER put ' '(space) between if row ending with '-'.MOST CRITICAL NEVER include word 'Pair' in ProductName.
Return same Description for all the

Take your time to process the image thoroughly and return accurate results and REMEMBER to extract all these values.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64
        }
      }
    ]);

    const response = await result.response;
    let text = response.text();
    
    text = text.replace(/```json\s*|\s*```/g, '').trim();
    
    try {
      const parsedArray = JSON.parse(text);
      if (!Array.isArray(parsedArray)) {
          console.error('AI response is not a JSON array:', text);
          throw new Error('Invalid AI response format: Expected a JSON array');
      }

      const resultsArray = parsedArray.map(parsedData => {
        let gross = null;
        let net = null;
        gross = Number(parsedData.grossnet[0]);
        net = Number(parsedData.grossnet[1]);
        let grossnet = false;
        if (
          gross !== null && net !== null &&
          !isNaN(gross) && !isNaN(net)
        ) {
          grossnet = gross === net;
        }
        if(parsedData.grossnet[0]===null || parsedData.grossnet[1]===null){
          grossnet=false;
        }
        return {
          cgst: parsedData.cgst !== null ? Number(parsedData.cgst) : null,
          sgst: parsedData.sgst !== null ? Number(parsedData.sgst) : null,
          igst: parsedData.igst !== null ? Number(parsedData.igst) : null,
          partyName: parsedData.partyName,
          date: parsedData.date,
          HSNNumber: parsedData.HSNNumber !== null ? Number(parsedData.HSNNumber) : null,
          Unit: parsedData.Unit,
          VNo: parsedData.VNo,
          ProductName: parsedData.ProductName,
          grossnet,
          TaxableValue: parsedData.TaxableValue !== null ? Number(parsedData.TaxableValue) : null,
          Quantity: parsedData.Quantity !== null ? Number(parsedData.Quantity) : null
        };
      });

      if (resultsArray.length > 0) {
        console.log(parsedArray);
      }
      
      return resultsArray; 
    } catch (e) {
      console.error('Error parsing AI response:', e);
      console.error('Raw response:', text);
      throw new Error('Failed to parse AI response as JSON array');
    }
  } catch (error) {
    console.error('Error analyzing invoice:', error);
    throw error;
  }
}

async function processInvoicePDF(pdfPath, specificPages = null) {
  try {
    const images = await convertPdfToImages(pdfPath);
    
    const imagesToProcess = specificPages 
      ? images.filter((_, index) => specificPages.includes(index + 1))
      : images;
    
    let invoiceOverallDate = null;

    const batchSize = 10;
    const allProducts = [];
    
    for (let i = 0; i < imagesToProcess.length; i += batchSize) {
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(imagesToProcess.length/batchSize)}`);
      
      const batchImages = imagesToProcess.slice(i, i + batchSize);
      
      const batchPromises = batchImages.map(async (image, index) => {
        try {
          const pageProducts = await analyzeInvoiceImage(image);

          const productsWithPage = pageProducts.map(product => ({
            ...product,
            pageNumber: specificPages ? specificPages[i + index] : i + index + 1, // Use specific page numbers if provided
            date: invoiceOverallDate || product.date // Use the overall date if available, otherwise use product's own extracted date
          }));
          return productsWithPage;
        } catch (error) {
          console.error(`Error processing page ${i + index + 1}:`, error);
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      allProducts.push(...batchResults.flat());

      if (i + batchSize < imagesToProcess.length) {
        console.log('Waiting 60 seconds before processing next batch...');
        await new Promise(resolve => setTimeout(resolve, 80000)); // Wait 60 seconds
      }
    }

    return allProducts;
  } catch (error) {
    console.error('Error processing invoice PDF:', error);
    throw error;
  }
}

module.exports = {
  processInvoicePDF
};