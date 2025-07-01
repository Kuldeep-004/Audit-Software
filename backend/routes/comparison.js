const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path'); 
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');
const { processInvoicePDF } = require('../services/geminiService');
const fs = require('fs');

// Utility function to convert Excel header names to mismatchedFields keys
const getMismatchedFieldKey = (excelHeader) => {
  const mapping = {
    'Page Number': 'pageNumber',
    'CGST': 'cgst',
    'SGST': 'sgst',
    'IGST': 'igst',
    'VNo': 'vno',
    'Date': 'date',
    'Party Name': 'partyName',
    'Product Name': 'ProductName',
    'HSN Number': 'hsnNumber',
    'Unit': 'unit',
    'Taxable Value': 'taxableValue',
    'Quantity': 'quantity',
    'Gross/Net Weight': 'grossnet'
  };
  return mapping[excelHeader] || null;
};

// Utility function to remove all spaces from a string
const removeAllSpaces = (str) => {
  if (!str) return '';
  return str.toString().replace(/\s+/g, '');
};

// Function to compare product names character by character
const compareProductNames = (invoiceName, excelName) => {
  const cleanInvoiceName = removeAllSpaces(invoiceName || '').toLowerCase();
  const cleanExcelName = removeAllSpaces(excelName || '').toLowerCase();

  const n = cleanInvoiceName.length;
  const m = cleanExcelName.length;

  const forwardMatches = new Array(n).fill(false);
  const backwardMatches = new Array(n).fill(false);

  // Forward comparison
  for (let i = 0; i < n && i < m; i++) {
    if (cleanInvoiceName[i] === cleanExcelName[i]) {
      forwardMatches[i] = true;
    }
  }

  // Backward comparison
  for (let i = 0; i < n && i < m; i++) {
    const invoiceEndIndex = n - 1 - i;
    const excelEndIndex = m - 1 - i;
    if (cleanInvoiceName[invoiceEndIndex] === cleanExcelName[excelEndIndex]) {
      backwardMatches[invoiceEndIndex] = true;
    }
  }

  // Combine matches and determine overall mismatch
  let hasOverallMismatch = false;
  const comparisonResults = [];

  for (let i = 0; i < n; i++) {
    const char = cleanInvoiceName[i];
    const matches = forwardMatches[i] || backwardMatches[i];
    if (!matches) {
      hasOverallMismatch = true;
    }
    comparisonResults.push({ character: char, matches: matches });
  }

  return {
    hasMismatch: hasOverallMismatch,
    comparison: comparisonResults
  };
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Get PDF page count endpoint
router.post('/get-page-count', upload.single('pdfFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Please upload a PDF file' });
    }

    const dataBuffer = fs.readFileSync(req.file.path);
    const str = dataBuffer.toString();
    const pageCount = (str.match(/\/Page\s/g) || []).length;

    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);

    res.json({ pageCount });
  } catch (error) {
    console.error('Error getting page count:', error);
    res.status(500).json({ 
      message: 'Error processing PDF file',
      error: error.message 
    });
  }
});

// Compare files endpoint
router.post('/compare', upload.fields([
  { name: 'excelFile', maxCount: 1 },
  { name: 'docsFile', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.excelFile || !req.files.docsFile) {
      return res.status(400).json({ message: 'Please upload both files' });
    }

    const excelFile = req.files.excelFile[0];
    const docsFile = req.files.docsFile[0];


    let excelData;
    // Process Excel file
    try {
      const workbook = xlsx.readFile(excelFile.path);
      const sheetName = workbook.SheetNames[0];
      excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false });
    } catch (error) {
      console.error('Error processing Excel file:', error);
      return res.status(500).json({ 
        message: 'Error processing Excel file',
        error: error.message 
      });
    }

    // Process invoice PDF using Gemini AI
    let invoiceData;
    try {
      console.log('\n=== Initial Invoice Processing ===');
      invoiceData = await processInvoicePDF(docsFile.path);
    } catch (error) {
      console.error('Error processing invoice PDF:', error);
      return res.status(500).json({ 
        message: 'Error processing invoice PDF',
        error: error.message 
      });
    }

    // Compare the data and find missing products
    const missingProducts = [];
    const productNameMismatches = new Map(); // Use a Map to store unique mismatches by pageNumber
    
    // Helper function to safely compare values
    const safeCompare = (val1, val2, type = 'string') => {
      // Check if both values are undefined/null/empty
      const isEmpty1 = val1 === undefined || val1 === null || val1 === '';
      const isEmpty2 = val2 === undefined || val2 === null || val2 === '';
      
      // If both are empty, they match
      if (isEmpty1 && isEmpty2) return true;
      
      // If only one is empty, they don't match
      if (isEmpty1 || isEmpty2) return false;
      
      if (type === 'number') {
        const num1 = Number(val1);
        const num2 = Number(val2);
        if (isNaN(num1) || isNaN(num2)) return false;
        return Math.abs(num1 - num2) < 0.001;
      }

      return val1.toString().trim().toLowerCase() === val2.toString().trim().toLowerCase();
    };

    invoiceData.forEach(invoice => {
      // Check if this is a tax-free product
      const isTaxFree = !invoice.cgst && !invoice.sgst && !invoice.igst && !invoice.TaxableValue;
 
      // Find an exact match in excelData based on ALL details
      const exactMatch = excelData.find(item => {
        // Convert tax values to numbers with 2 decimal places
        const excelCgst = item["CGST"] ? Number(Number(item["CGST"]).toFixed(2)) : null;
        const excelSgst = item["SGST/UTGST"] ? Number(Number(item["SGST/UTGST"]).toFixed(2)) : null;
        const excelIgst = item["IGST"] ? Number(Number(item["IGST"]).toFixed(2)) : null;
        
        const invoiceCgst = invoice.cgst ? Number(Number(invoice.cgst).toFixed(2)) : null;
        const invoiceSgst = invoice.sgst ? Number(Number(invoice.sgst).toFixed(2)) : null;
        const invoiceIgst = invoice.igst ? Number(Number(invoice.igst).toFixed(2)) : null;
        
        const isExcelFree = item["Free"]?.toString().trim().toLowerCase() === invoice.Quantity?.toString().trim().toLowerCase();
        
        let taxMatch = false;

        // If the invoice has no tax values, it is a tax-free product
        if (isTaxFree) {
          taxMatch = true;
        }
          
        // For tax-free products, we only compare with 'Free' quantity in Excel
        if (isTaxFree) {
          // For tax-free products, we should match regardless of quantity
          const match = (
            taxMatch &&
            (item["VNo"] || '').toString().trim() === (invoice.VNo || '').toString().trim() &&
            (item["Party Name"] || '').toString().trim().toLowerCase() === (invoice.partyName || '').toString().trim().toLowerCase() &&
            (item["HSN Number"] || '').toString().trim() === (invoice.HSNNumber || '').toString().trim() &&
            (item["Unit"] || '').toString().trim().toLowerCase() === (invoice.Unit || '').toString().trim().toLowerCase() &&
            (item["Taxable Value"] || '').toString().trim() === (invoice.TaxableValue || '').toString().trim() && isExcelFree && invoice.grossnet
          );
          return match;
        }

        // For products with taxes, use normal comparison
        if (excelIgst !== null) {
          taxMatch = excelIgst === invoiceIgst && 
                    (invoiceCgst === null || invoiceCgst === 0) && 
                    (invoiceSgst === null || invoiceSgst === 0);
        } else if (excelCgst !== null && excelSgst !== null) {
          taxMatch = excelCgst === invoiceCgst && 
                    excelSgst === invoiceSgst && 
                    (invoiceIgst === null || invoiceIgst === 0);
        }

        const match = (
          taxMatch &&
          (item["VNo"] || '').toString().trim() === (invoice.VNo || '').toString().trim() &&
          (item["Party Name"] || '').toString().trim().toLowerCase() === (invoice.partyName || '').toString().trim().toLowerCase() &&
          (item["HSN Number"] || '').toString().trim() === (invoice.HSNNumber || '').toString().trim() &&
          (item["Unit"] || '').toString().trim().toLowerCase() === (invoice.Unit || '').toString().trim().toLowerCase() &&
          (item["Taxable Value"] || '').toString().trim() === (invoice.TaxableValue || '').toString().trim() &&
          safeCompare(item["Quantity"], invoice.Quantity, 'number') && invoice.grossnet
        );

        return match;
      });

      // Compare product names separately
      const matchingExcelRow = excelData.find(item => {
        // Find matching row based on other criteria (excluding ProductName)
        const excelCgst = item["CGST"] ? Number(Number(item["CGST"]).toFixed(2)) : null;
        const excelSgst = item["SGST/UTGST"] ? Number(Number(item["SGST/UTGST"]).toFixed(2)) : null;
        const excelIgst = item["IGST"] ? Number(Number(item["IGST"]).toFixed(2)) : null;
        
        const invoiceCgst = invoice.cgst ? Number(Number(invoice.cgst).toFixed(2)) : null;
        const invoiceSgst = invoice.sgst ? Number(Number(invoice.sgst).toFixed(2)) : null;
        const invoiceIgst = invoice.igst ? Number(Number(invoice.igst).toFixed(2)) : null;
        
        let taxMatch = false;
        if (isTaxFree) {
          taxMatch = true;
        } else if (excelIgst !== null) {
          taxMatch = excelIgst === invoiceIgst && 
                    (invoiceCgst === null || invoiceCgst === 0) && 
                    (invoiceSgst === null || invoiceSgst === 0);
        } else if (excelCgst !== null && excelSgst !== null) {
          taxMatch = excelCgst === invoiceCgst && 
                    excelSgst === invoiceSgst && 
                    (invoiceIgst === null || invoiceIgst === 0);
        }

        return taxMatch &&
               (item["VNo"] || '').toString().trim() === (invoice.VNo || '').toString().trim() &&
               (item["Party Name"] || '').toString().trim().toLowerCase() === (invoice.partyName || '').toString().trim().toLowerCase() &&
               (item["HSN Number"] || '').toString().trim() === (invoice.HSNNumber || '').toString().trim() &&
               (item["Unit"] || '').toString().trim().toLowerCase() === (invoice.Unit || '').toString().trim().toLowerCase() &&
               (item["Taxable Value"] || '').toString().trim() === (invoice.TaxableValue || '').toString().trim() &&
               safeCompare(item["Quantity"], invoice.Quantity, 'number') &&
               invoice.grossnet;
      });

      if (matchingExcelRow) {
        const productNameComparison = compareProductNames(invoice.ProductName, matchingExcelRow["Product Name"]);
        if (productNameComparison.hasMismatch) {
          // Store only one product name mismatch per page number
          if (!productNameMismatches.has(invoice.pageNumber)) {
            productNameMismatches.set(invoice.pageNumber, {
              pageNumber: invoice.pageNumber,
              invoiceProductName: invoice.ProductName,
              invoiceVNo: invoice.VNo,
              excelProductName: matchingExcelRow["Product Name"],
              comparison: productNameComparison.comparison
            });
          }
        }
      }

      if (!exactMatch) {
        // Find all rows with matching VNo
        const matchingVNoRows = excelData.filter(item => 
          (item["VNo"] || '').toString().trim() === (invoice.VNo || '').toString().trim()
        );

        let bestMatch = null;
        let maxMatchingFields = 0;
        let mismatchedFields = [];

        if (matchingVNoRows.length > 0) {
          matchingVNoRows.forEach(item => {
            const matchingFields = [];
            const nonMatchingFields = [];

            // Convert tax values to numbers with 2 decimal places
            const excelCgst = item["CGST"] ? Number(Number(item["CGST"]).toFixed(2)) : null;
            const excelSgst = item["SGST/UTGST"] ? Number(Number(item["SGST/UTGST"]).toFixed(2)) : null;
            const excelIgst = item["IGST"] ? Number(Number(item["IGST"]).toFixed(2)) : null;
            
            const invoiceCgst = invoice.cgst ? Number(Number(invoice.cgst).toFixed(2)) : null;
            const invoiceSgst = invoice.sgst ? Number(Number(invoice.sgst).toFixed(2)) : null;
            const invoiceIgst = invoice.igst ? Number(Number(invoice.igst).toFixed(2)) : null;

            const isExcelFree = item["Quantity"]?.toString().trim().toLowerCase() === 'free';

            // Check tax fields
            if(isTaxFree){
              
              if (excelIgst === invoiceIgst) matchingFields.push('igst');
              else nonMatchingFields.push('igst');

              if (excelCgst === invoiceCgst) matchingFields.push('cgst');
              else nonMatchingFields.push('cgst');

              if (excelSgst === invoiceSgst) matchingFields.push('sgst');
              else nonMatchingFields.push('sgst');

            }
              else if (excelIgst !== null) {
              if (excelIgst === invoiceIgst) matchingFields.push('igst');
              else nonMatchingFields.push('igst');

              if (invoiceCgst == null || invoiceCgst == 0) matchingFields.push('cgst');
              else nonMatchingFields.push('cgst');

              if (invoiceSgst == null || invoiceSgst == 0) matchingFields.push('sgst');
              else nonMatchingFields.push('sgst');
            } else if (excelCgst !== null && excelSgst !== null) {
              if (excelCgst === invoiceCgst) matchingFields.push('cgst');
              else nonMatchingFields.push('cgst');

              if (excelSgst === invoiceSgst) matchingFields.push('sgst');
              else nonMatchingFields.push('sgst');

              if (invoiceIgst === null || invoiceIgst === 0) matchingFields.push('igst');
              else nonMatchingFields.push('igst');
            } else {
              // If no tax values in Excel, mark all tax fields as mismatched
              nonMatchingFields.push('cgst', 'sgst', 'igst');
            }

            // For tax-free products, we don't compare quantity at all
            if (isTaxFree) {
              // Don't add quantity to either matching or non-matching fields for tax-free products
            } else {
              // For products with taxes, compare quantity normally
              if (safeCompare(item["Quantity"], invoice.Quantity, 'number')) {
                matchingFields.push('quantity');
              } else {
                nonMatchingFields.push('quantity');
              }
            }

            // Compare other fields
            if (safeCompare(item["Party Name"], invoice.partyName)) matchingFields.push('partyName');
            else nonMatchingFields.push('partyName');

            if (safeCompare(item["HSN Number"], invoice.HSNNumber)) matchingFields.push('hsnNumber');
            else nonMatchingFields.push('hsnNumber');

            if (safeCompare(item["Unit"], invoice.Unit)) matchingFields.push('unit');
            else nonMatchingFields.push('unit');

            if (safeCompare(item["Taxable Value"], invoice.TaxableValue)) matchingFields.push('taxableValue');
            else nonMatchingFields.push('taxableValue');

            if (invoice.grossnet) {
              matchingFields.push('grossnet');
            } else {
              nonMatchingFields.push('grossnet');
            }

            if (matchingFields.length > maxMatchingFields) {
              maxMatchingFields = matchingFields.length;
              bestMatch = item;
              mismatchedFields = nonMatchingFields;
            }
          });
        } else {
          mismatchedFields = [
            'cgst', 'sgst', 'igst', 'vno', 'date', 'partyName', 
            'hsnNumber', 'unit', 'taxableValue', 'quantity', 'grossnet'
          ];
        }

        // Only add to missing products if there are mismatches in critical fields
        // Grossnet is removed from criticalFields so it doesn't cause an entire product to be marked as missing
        const criticalFields = ['cgst', 'sgst', 'igst', 'vno', 'partyName', 'hsnNumber', 'unit', 'taxableValue', 'quantity', 'grossnet'];
        const hasCriticalMismatches = mismatchedFields.some(field => criticalFields.includes(field));

        if (hasCriticalMismatches) {
          missingProducts.push({
            cgst: invoice.cgst,
            sgst: invoice.sgst,
            igst: invoice.igst,
            invoiceVNo: invoice.VNo,
            invoiceDate: invoice.date,
            invoicePartyName: invoice.partyName,
            invoiceProductName: invoice.ProductName,
            invoiceHSNNumber: invoice.HSNNumber,
            invoiceUnit: invoice.Unit,
            invoiceTaxableValue: invoice.TaxableValue,
            invoiceQuantity: invoice.Quantity,
            invoiceGrossnet: invoice.grossnet,
            mismatchedFields: mismatchedFields,
            pageNumber: invoice.pageNumber,
            matchingVNoRowsCount: matchingVNoRows.length
          });
        }
      }
    });

    // Clean up uploaded files
    try {
      fs.unlinkSync(excelFile.path);
      fs.unlinkSync(docsFile.path);
    } catch (error) {
      console.error('Error cleaning up files:', error);
    }

    console.log('\n=== Final Results ===');
    console.log('Total products in invoice:', invoiceData.length);
    console.log('Total products in Excel:', excelData.length);
    console.log('Missing products:', missingProducts.length);

    res.json({
      totalDocsProducts: invoiceData.length,
      totalExcelProducts: excelData.length,
      missingProducts,
      productNameMismatches: Array.from(productNameMismatches.values()), // Convert Map values to an array for response
      parsedInvoices: invoiceData.map(invoice => ({
        cgst: invoice.cgst,
        sgst: invoice.sgst,
        igst: invoice.igst,
        VNo: invoice.VNo,
        date: invoice.date,
        PartyName: invoice.partyName,
        ProductName: invoice.ProductName,
        HSNNumber: invoice.HSNNumber,
        Unit: invoice.Unit,
        TaxableValue: invoice.TaxableValue,
        Quantity: invoice.Quantity,
        grossnet: invoice.grossnet,
        pageNumber: invoice.pageNumber
      }))
    });

  } catch (error) {
    console.error('Error in comparison:', error);
    res.status(500).json({ 
      message: 'Error processing files',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Download Excel route
router.post('/download/:type', async (req, res) => {
  const type = req.params.type;
  const data = req.body.data;

  try {
    // Create a new workbook
    const workbook = new ExcelJS.Workbook();

    // Define styles
    const mismatchStyle = {
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC7CE' } }, // Light red
      font: { color: { argb: '9C0006' } } // Dark red
    };

    const matchStyle = {
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'C6EFCE' } }, // Light green
      font: { color: { argb: '006100' } } // Dark green
    };

    // Prepare data based on type
    let sheetData = [];
    let sheetName = '';

    switch (type) {
      case 'parsed':
        sheetData = data.parsedInvoices.map(item => ({
          'Page Number': item.pageNumber || '',
          'CGST': item.cgst || '',
          'SGST': item.sgst || '',
          'IGST': item.igst || '',
          'VNo': item.VNo || '',
          'Date': item.date || '',
          'Party Name': item.PartyName || '',
          'HSN Number': item.HSNNumber || '',
          'Unit': item.Unit || '',
          'Taxable Value': item.TaxableValue || '',
          'Quantity': item.Quantity || '',
          'Gross/Net Weight': item.grossnet ? 'Match' : 'Mismatch'
        }));
        sheetName = 'Parsed Invoice Data';
        break;

      case 'matched':
        const matchedProducts = data.parsedInvoices.filter(invoice => 
          !data.missingProducts.some(missing => 
            missing.cgst === invoice.cgst &&
            missing.sgst === invoice.sgst
          )
        );
        sheetData = matchedProducts.map(item => ({
          'Page Number': item.pageNumber || '',
          'CGST': item.cgst || '',
          'SGST': item.sgst || '',
          'IGST': item.igst || '',
          'VNo': item.VNo || '',
          'Date': item.date || '',
          'Party Name': item.PartyName || '',
          'HSN Number': item.HSNNumber || '',
          'Unit': item.Unit || '',
          'Taxable Value': item.TaxableValue || '',
          'Quantity': item.Quantity || '',
          'Gross/Net Weight': item.grossnet ? 'Match' : 'Mismatch'
        }));
        sheetName = 'Matched Data';
        break;

      case 'missing':
        sheetData = data.missingProducts.map(item => ({
          // Store original item along with flat data for styling purposes
          originalItem: item,
          excelRow: {
            'Page Number': item.pageNumber || '',
            'CGST': item.cgst || '',
            'SGST': item.sgst || '',
            'IGST': item.igst || '',
            'VNo': item.invoiceVNo || '',
            'Date': item.invoiceDate || '',
            'Party Name': item.invoicePartyName || '',
            'HSN Number': item.invoiceHSNNumber || '',
            'Unit': item.invoiceUnit || '',
            'Taxable Value': item.invoiceTaxableValue || '',
            'Quantity': item.invoiceQuantity || '',
            'Gross/Net Weight': item.invoiceGrossnet ? 'Match' : 'Mismatch'
          }
        }));
        sheetName = 'Missing Data';
        break;

      default:
        return res.status(400).json({ message: 'Invalid report type' });
    }

    // Create worksheet
    const worksheet = workbook.addWorksheet(sheetName);

    // Add headers
    const headers = type === 'missing' ? Object.keys(sheetData[0].excelRow) : Object.keys(sheetData[0] || {});
    worksheet.addRow(headers);

    // Style the header row
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center' };
    });

    // Add data rows and apply styling
    const rowsToAdd = type === 'missing' ? sheetData.map(item => Object.values(item.excelRow)) : sheetData.map(item => Object.values(item));

    rowsToAdd.forEach((rowValues, rowIndex) => {
      const dataRow = worksheet.addRow(rowValues);
      
      dataRow.eachCell((cell, colNumber) => {
        const header = headers[colNumber - 1];
        const mismatchedFieldKey = getMismatchedFieldKey(header);

        if (type === 'missing') {
          const originalItem = sheetData[rowIndex].originalItem;
          if (originalItem && originalItem.mismatchedFields && originalItem.mismatchedFields.includes(mismatchedFieldKey)) {
            // Apply red for mismatched fields
            cell.fill = mismatchStyle.fill;
            cell.font = mismatchStyle.font;
          } else if (mismatchedFieldKey === 'grossnet') {
            // Special handling for 'Gross/Net Weight' in missing type
            if (cell.value === 'Match') {
              cell.fill = matchStyle.fill;
              cell.font = matchStyle.font;
            } else {
              cell.fill = mismatchStyle.fill;
              cell.font = mismatchStyle.font;
            }
          } else {
            // Apply green for fields that are not mismatched in missing data
            cell.fill = matchStyle.fill;
            cell.font = matchStyle.font;
          }
        } else if (type === 'matched' || type === 'parsed') {
          // Remove color styling for matched and parsed sheets
          cell.fill = undefined;
          cell.font = undefined;
        }
      });
    });

    // Set column widths
    worksheet.columns.forEach(column => {
      column.width = 15;
    });

    // Add summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    const summaryData = [
      { 'Summary': 'Total Products in Invoice', 'Value': data.totalDocsProducts },
      { 'Summary': 'Total Products in Excel', 'Value': data.totalExcelProducts },
      { 'Summary': 'Missing Products', 'Value': data.missingProducts.length }
    ];

    // Add summary headers
    summarySheet.addRow(['Summary', 'Value']);

    // Style summary headers
    summarySheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center' };
    });

    // Add summary data
    summaryData.forEach(row => {
      summarySheet.addRow([row.Summary, row.Value]);
    });

    // Set summary column widths
    summarySheet.columns.forEach(column => {
      column.width = 30;
    });

    // Generate Excel buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${type}-report.xlsx`);

    // Send the Excel file
    res.send(buffer);

  } catch (error) {
    console.error('Error generating Excel:', error);
    res.status(500).json({ 
      message: 'Error generating Excel file',
      error: error.message 
    });
  }
});

module.exports = router; 