export interface ExecutiveOrder {
  executive_order_number?: string;
  title?: string;
  president?: string | null;
  president_source?: string;
  signing_date?: string;
  publication_date?: string;
  citation?: string;
  disposition_notes?: string;
  html_url?: string;
  pdf_url?: string;
  full_text_xml_url?: string;
  json_url?: string;
  document_number?: string;
  start_page?: string;
  end_page?: string;
  pdf_available?: boolean;
  year?: number;
}
