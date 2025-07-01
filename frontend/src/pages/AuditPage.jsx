import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-hot-toast';

const AuditPage = () => {
  const navigate = useNavigate();
  const [files, setFiles] = useState({
    excelFile: null,
    docsFile: null
  });
  const [comparisonResults, setComparisonResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [processingStatus, setProcessingStatus] = useState(''); 
  const [dragOver, setDragOver] = useState({
    excel: false,
    pdf: false
  });
  const [estimatedTime, setEstimatedTime] = useState(null);

  // Helper to check if grossnet values match
  const checkGrossnetMatch = (grossnet) => {
    if (!grossnet || !Array.isArray(grossnet) || grossnet.length !== 2) return false;
    const [gross, net] = grossnet;
    if (gross == null || net == null) return false;
    return Math.abs(gross - net) < 0.001;
  };

  const calculateEstimatedTime = async (pdfFile) => {
    try {
      const formData = new FormData();
      formData.append('pdfFile', pdfFile);
      const response = await axios.post('http://localhost:5000/api/comparison/get-page-count', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      const pageCount = response.data.pageCount;
      const estimatedSeconds = pageCount * 1.7;
      const minutes = Math.floor(estimatedSeconds / 60);
      const seconds = Math.round(estimatedSeconds % 60);
      setEstimatedTime(`${minutes} minutes and ${seconds} seconds`);
    } catch (error) {
      console.error('Error calculating estimated time:', error);
      setEstimatedTime(null);
    }
  };

  const handleFileChange = (e) => {
    const { name, files: selectedFiles } = e.target;
    setFiles(prev => ({
      ...prev,
      [name]: selectedFiles[0]
    }));
    
    if (name === 'docsFile' && selectedFiles[0]) {
      calculateEstimatedTime(selectedFiles[0]);
    } else if (name === 'docsFile') {
      setEstimatedTime(null);
    }
  };

  const handleDrop = (e, type) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(prev => ({ ...prev, [type]: false }));
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (type === 'excel') {
      if (!file.name.match(/\.(xlsx|xls)$/i)) {
        toast.error('Please drop a valid Excel file (.xlsx, .xls)');
        return;
      }
      setFiles(prev => ({ ...prev, excelFile: file }));
    } else if (type === 'pdf') {
      if (!file.name.match(/\.pdf$/i)) {
        toast.error('Please drop a valid PDF file');
        return;
      }
      setFiles(prev => ({ ...prev, docsFile: file }));
      calculateEstimatedTime(file);
    }
  };

  const handleDragOver = (e, type) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(prev => ({ ...prev, [type]: true }));
  };

  const handleDragLeave = (e, type) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(prev => ({ ...prev, [type]: false }));
  };

  const handleCompare = async (e) => {
    e.preventDefault();
    
    if (!files.excelFile || !files.docsFile) {
      toast.error('Please select both Excel and Invoice files');
      return;
    }

    setIsLoading(true);
    setProcessingStatus('AI Is Processing...');
    const formData = new FormData();
    formData.append('excelFile', files.excelFile);
    formData.append('docsFile', files.docsFile);

    try {
      const response = await axios.post('http://localhost:5000/api/comparison/compare', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setComparisonResults(response.data);
      toast.success('Comparison completed successfully');
    } catch (error) {
      console.error('Comparison error:', error);
      const errorMessage = error.response?.data?.message || 'Error comparing files';
      const errorDetails = error.response?.data?.error;
      
      toast.error(
        <div>
          <p className="font-bold">{errorMessage}</p>
          {errorDetails && <p className="text-sm mt-1">{errorDetails}</p>}
        </div>
      );
    } finally {
      setIsLoading(false);
      setProcessingStatus('');
    }
  };

  const handleDownloadPDF = async (type) => {
    if (!comparisonResults) {
      toast.error('No data available for download');
      return;
    }

    try {
      const response = await axios.post(`http://localhost:5000/api/comparison/download/${type}`, {
        data: comparisonResults
      }, {
        responseType: 'blob'
      });

      // Create a download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${type}-report.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Error downloading Excel file');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">Audit Dashboard</h1>
            </div>
            <div className="flex items-center">
              <button
                onClick={handleLogout}
                className="btn-secondary"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium mb-6">Compare Files</h2>
            
            <form onSubmit={handleCompare} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Excel File Upload */}
                <div
                  className={`border-2 border-dashed rounded-lg p-6 transition-colors ${
                    dragOver.excel ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-500'
                  }`}
                  onDrop={e => handleDrop(e, 'excel')}
                  onDragOver={e => handleDragOver(e, 'excel')}
                  onDragLeave={e => handleDragLeave(e, 'excel')}
                >
                  <div className="text-center">
                    <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                      <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Excel File</label>
                      <input
                        type="file"
                        name="excelFile"
                        onChange={handleFileChange}
                        accept=".xlsx,.xls"
                        className="block w-full text-sm text-gray-500
                          file:mr-4 file:py-2 file:px-4
                          file:rounded-md file:border-0
                          file:text-sm file:font-semibold
                          file:bg-blue-50 file:text-blue-700
                          hover:file:bg-blue-100"
                      />
                      {files.excelFile && (
                        <div className="mt-2 text-xs text-green-600">Selected: {files.excelFile.name}</div>
                      )}
                      <div className="mt-2 text-xs text-gray-500">Drag & drop or click to select an Excel file</div>
                    </div>
                  </div>
                </div>

                {/* Invoice File Upload */}
                <div
                  className={`border-2 border-dashed rounded-lg p-6 transition-colors ${
                    dragOver.pdf ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-500'
                  }`}
                  onDrop={e => handleDrop(e, 'pdf')}
                  onDragOver={e => handleDragOver(e, 'pdf')}
                  onDragLeave={e => handleDragLeave(e, 'pdf')}
                >
                  <div className="text-center">
                    <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                      <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Invoice PDF</label>
                      <input
                        type="file"
                        name="docsFile"
                        onChange={handleFileChange}
                        accept=".pdf"
                        className="block w-full text-sm text-gray-500
                          file:mr-4 file:py-2 file:px-4
                          file:rounded-md file:border-0
                          file:text-sm file:font-semibold
                          file:bg-blue-50 file:text-blue-700
                          hover:file:bg-blue-100"
                      />
                      {files.docsFile && (
                        <div className="mt-2 text-xs text-green-600">Selected: {files.docsFile.name}</div>
                      )}
                      <div className="mt-2 text-xs text-gray-500">Drag & drop or click to select a PDF file</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="btn-primary px-8 py-3 text-lg"
                >
                  {isLoading ? 'Processing...' : 'Compare Files'}
                </button>
              </div>
            </form>

            {processingStatus && (
              <div className="mt-4 text-center text-gray-600">
                {processingStatus}
              </div>
            )}

            {comparisonResults && (
              <div className="mt-8">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium">Comparison Results</h3>
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full max-w-3xl mx-auto mb-4">
                    <button
                      onClick={() => handleDownloadPDF('missing')}
                      className="btn-secondary w-full py-3 text-base font-semibold rounded-md shadow-sm transition hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      Download Missing Data (Excel)
                    </button>
                    <button
                      onClick={() => handleDownloadPDF('matched')}
                      className="btn-secondary w-full py-3 text-base font-semibold rounded-md shadow-sm transition hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      Download Matched Data (Excel)
                    </button>
                    <button
                      onClick={() => handleDownloadPDF('parsed')}
                      className="btn-secondary w-full py-3 text-base font-semibold rounded-md shadow-sm transition hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      Download All Data    
                      <p>(Excel)</p>
                    </button>
                  </div>
                </div>
                
                <div className="bg-gray-50 p-4 rounded-lg mb-4">
                  <p>Total Products in Invoice: {comparisonResults.totalDocsProducts}</p>
                  <p>Total Products in Excel: {comparisonResults.totalExcelProducts}</p>
                  <p>Missing Products: {comparisonResults.missingProducts.length}</p>
                </div>

                {/* Missing Products Table */}
                <div className="mb-8">
                  <h4 className="text-md font-medium">Missing Products</h4>
                  <h4> ( Invoice Data Not Matching With Excel )</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Page</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CGST</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SGST</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IGST</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice VNo</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Party Name</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">HSN Number</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Taxable Value</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gross/Net Weight</th>
                        </tr>
                      </thead> 
                      <tbody className="bg-white divide-y divide-gray-200">
                        {comparisonResults.missingProducts.map((missing, index) => {
                          console.log('Rendering Missing Product:', missing);
                          return (
                          <tr key={index}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {missing.pageNumber}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                              missing.mismatchedFields?.includes('cgst') ? 'bg-red-100' : 'bg-green-100'
                            }`}>
                              {missing.cgst}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                              missing.mismatchedFields?.includes('sgst') ? 'bg-red-100' : 'bg-green-100'
                            }`}>
                              {missing.sgst}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                              missing.mismatchedFields?.includes('igst') ? 'bg-red-100' : 'bg-green-100'
                            }`}>
                              {missing.igst}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                              missing.mismatchedFields?.includes('vno') ? 'bg-red-100' : 'bg-green-100'
                            }`}>
                              {missing.invoiceVNo}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                              missing.mismatchedFields?.includes('date') ? 'bg-red-100' : 'bg-green-100'
                            }`}>
                              {missing.invoiceDate}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                              missing.mismatchedFields?.includes('partyName') ? 'bg-red-100' : 'bg-green-100'
                            }`}>
                              {missing.invoicePartyName}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                              missing.mismatchedFields?.includes('hsnNumber') ? 'bg-red-100' : 'bg-green-100'
                            }`}>
                              {missing.invoiceHSNNumber}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                              missing.mismatchedFields?.includes('unit') ? 'bg-red-100' : 'bg-green-100'
                            }`}>
                              {missing.invoiceUnit}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                              missing.mismatchedFields?.includes('taxableValue') ? 'bg-red-100' : 'bg-green-100'
                            }`}>
                              {missing.invoiceTaxableValue}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                              missing.mismatchedFields?.includes('quantity') ? 'bg-red-100' : 'bg-green-100'
                            }`}>
                              {missing.invoiceQuantity}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                              missing.mismatchedFields?.includes('grossnet') ? 'bg-red-100' : 'bg-green-100'
                            }`}>
                              {missing.invoiceGrossnet ? <span>Match</span> : <span>Mismatch</span>}
                            </td>
                          </tr>
                        );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Product Name Mismatches - New Table */}
                <div className="mb-8">
                  <h4 className="text-md font-medium">Product Name Mismatches</h4>
                  <h4>(Character by Character Comparison)</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Page Number</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice No</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product Name Comparison</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {comparisonResults.productNameMismatches?.map((mismatch, index) => (
                          <tr key={index}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {mismatch.pageNumber}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {mismatch.invoiceVNo}
                            </td>
                            <td className="px-6 py-4 text-sm">
                              {(() => {
                                let cleanCharIndex = 0;
                                return mismatch.invoiceProductName.split('').map((char, index) => {
                                  if (char === ' ') {
                                    return <span key={index}>{char}</span>;
                                  }

                                  const charComparison = mismatch.comparison[cleanCharIndex];
                                  const matches = charComparison?.matches || false;
                                  cleanCharIndex++; // Increment only for non-space characters

                                  return (
                                    <span
                                      key={index}
                                      className={matches ? 'text-green-600' : 'text-red-600'}
                                    >
                                      {char}
                                    </span>
                                  );
                                });
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Matched Products - Now Second */}
                <div className="mb-8">
                  <h4 className="text-md font-medium">Matched Products</h4>
                  <h4> ( Invoice Data Completely Matching With Excel )</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Page</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CGST</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SGST</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IGST</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">VNo</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Party Name</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">HSN Number</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Taxable Value</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gross/Net Weight</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {comparisonResults.parsedInvoices
                          .filter(invoice => 
                            !comparisonResults.missingProducts.some(missing => 
                              missing.invoiceVNo === invoice.VNo &&
                              missing.invoicePartyName === invoice.PartyName &&
                              missing.invoiceHSNNumber === invoice.HSNNumber &&
                              missing.invoiceUnit === invoice.Unit &&
                              missing.invoiceTaxableValue === invoice.TaxableValue &&
                              missing.invoiceQuantity === invoice.Quantity
                            )
                          )
                          .map((invoice, index) => (
                            <tr key={index}>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {invoice.pageNumber}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {invoice.cgst}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {invoice.sgst}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {invoice.igst}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {invoice.VNo}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {invoice.date}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {invoice.PartyName}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {invoice.HSNNumber}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {invoice.Unit}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {invoice.TaxableValue}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {invoice.Quantity}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {invoice.grossnet ? <span>Match</span> : <span></span>}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Parsed Invoice Data - Now Last */}
                <div className="mb-8">
                  <h4 className="text-md font-medium mb-4">All Invoice Data</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Page</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CGST</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SGST</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IGST</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">VNo</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Party Name</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">HSN Number</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Taxable Value</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gross/Net Weight</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {comparisonResults.parsedInvoices.map((invoice, index) => (
                          <tr key={index}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {invoice.pageNumber}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {invoice.cgst}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {invoice.sgst}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {invoice.igst}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {invoice.VNo}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {invoice.date}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {invoice.PartyName}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {invoice.HSNNumber}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {invoice.Unit}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {invoice.TaxableValue}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {invoice.Quantity}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {invoice.grossnet ? <span>Match</span> : <span>MisMatch</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default AuditPage; 